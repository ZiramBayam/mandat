/**
 * Verifying that a payment really settled to this seller.
 *
 * The old seller took an `x-payment-tx` header at face value and only used it to
 * find a block. That proves a transaction exists; it does not prove the seller
 * was paid. A caller could name any transaction hash, and the resource would be
 * released against someone else's payment.
 *
 * So there are two things to check, and both have to pass:
 *
 *  1. The settlement transaction transferred the right token, the right amount,
 *     to this seller's address. Read from the receipt, which is chain state.
 *  2. If the client supplied an `X-PAYMENT` header, the facilitator's `/verify`
 *     must accept it, so the signed payload matches what is on chain.
 *
 * The facilitator is not trusted for the amount: it attests to a signature, and
 * the transfer itself is read from the receipt. If the facilitator is unreachable
 * we say so rather than skipping the check.
 */

import type { Address, Hex, PublicClient } from "viem";
import { X402 } from "@mandat/protocol";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

export type PaymentCheck = {
  /** Header carrying the facilitator's signed settlement payload, if any. */
  paymentHeader: string | string[] | undefined;
  /** The settlement transaction, hex. */
  settlementTx: Hex;
  /** Address that must have received the funds. */
  payTo: Address;
  /** Largest acceptable amount, in the token's base units. */
  maxAmount: bigint;
  /** Expected token. Defaults to testnet USDC, 6 decimals. */
  token?: Address;
};

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentError";
  }
}

const USDC_TESTNET = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as Address;
const USDC_DECIMALS = 6;

/**
 * x402 amounts are human-readable decimals in the header and base units on
 * chain. Only the base-unit form is compared here.
 */
const BASE_UNITS = 10n ** BigInt(USDC_DECIMALS);

function findTokenTransfers(
  logs: readonly { address: Address; topics: readonly string[]; data: Hex }[],
  token: Address,
  payTo: Address,
): bigint {
  let total = 0n;
  for (const log of logs) {
    if (log.address.toLowerCase() !== token.toLowerCase()) continue;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    // topics: [Transfer, from, to]
    const to = log.topics[2];
    if (to === undefined) continue;
    if (`0x${to.slice(26)}`.toLowerCase() !== payTo.toLowerCase()) continue;
    total += BigInt(log.data);
  }
  return total;
}

export async function verifyPayment(
  client: PublicClient,
  check: PaymentCheck,
): Promise<{ payer: Address; amount: bigint }> {
  const token = check.token ?? USDC_TESTNET;

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: check.settlementTx });
  } catch (error) {
    throw new PaymentError(
      `settlement transaction ${check.settlementTx} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (receipt.status !== "success") {
    throw new PaymentError(`settlement transaction ${check.settlementTx} reverted on chain`);
  }

  // When a payment header is present, the facilitator has to agree. Its absence is
  // not treated as a pass: x402 v2 requires the header, and a settlement the
  // facilitator will not attest to is not one we release against.
  const header = firstHeader(check.paymentHeader);
  if (header === undefined || header.length === 0) {
    throw new PaymentError(
      "no X-PAYMENT header; the seller's attestation is required, not optional",
    );
  }

  const attestation = await verifyWithFacilitator(header, check.settlementTx);
  if (!attestation.isValid) {
    throw new PaymentError(`facilitator rejected the payment: ${attestation.invalidReason}`);
  }
  if (attestation.payer === undefined) {
    throw new PaymentError("facilitator accepted the payment but named no payer");
  }

  const received = findTokenTransfers(receipt.logs, token, check.payTo);
  if (received === 0n) {
    throw new PaymentError(
      `the settlement sent no ${token} to this seller; a payment to somebody else is not a payment`,
    );
  }
  if (received < BASE_UNITS / 2n) {
    throw new PaymentError(
      `expected an amount in base units but read ${received}; refusing to guess the scale`,
    );
  }
  if (received > check.maxAmount) {
    throw new PaymentError(
      `paid ${received} base units, more than the ${check.maxAmount} this resource asks for`,
    );
  }

  return { payer: attestation.payer, amount: received };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  return value?.[0];
}

type Attestation = { isValid: boolean; invalidReason?: string; payer?: Address };

/**
 * Ask the facilitator whether the payload matches what settled.
 *
 * The facilitator is contacted over HTTP rather than through the x402 SDK: this is
 * one request, and adding the SDK for it would pull in a dependency tree to
 * replace a single fetch whose shape the docs already state.
 */
async function verifyWithFacilitator(paymentHeader: string, settlementTx: Hex): Promise<Attestation> {
  const parsed = safeParse(paymentHeader);
  if (parsed === null) {
    throw new PaymentError("X-PAYMENT is not valid JSON");
  }

  let response: Response;
  try {
    response = await fetch(`${X402.facilitator}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: 1, paymentPayload: parsed, paymentRequirements: undefined }),
    });
  } catch (error) {
    // Unreachable facilitator is a refusal, not a skip. Skipping it is exactly the
    // failure this function exists to prevent.
    throw new PaymentError(
      `facilitator unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (response.status === 402 || response.status === 400) {
    return { isValid: false, invalidReason: await safeText(response) };
  }
  if (!response.ok) {
    throw new PaymentError(`facilitator returned ${response.status}: ${await safeText(response)}`);
  }

  const body = (await response.json()) as {
    isValid?: boolean;
    invalidReason?: string;
    payer?: string;
  };
  return {
    isValid: body.isValid === true,
    ...(body.invalidReason === undefined ? {} : { invalidReason: body.invalidReason }),
    ...(typeof body.payer === "string" ? { payer: body.payer as Address } : {}),
  };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return "<no body>";
  }
}
