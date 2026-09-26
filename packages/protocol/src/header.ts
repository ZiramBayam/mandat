/**
 * The Authority Header: proof of authority carried inside a 402 flow.
 *
 * The seller cannot read delegations off chain (no `delegations(address,bytes32)`
 * view in DTK v1.3.0), so the client must carry them and the seller must
 * re-derive. `claims` is a convenience for readers including agents; the seller
 * never trusts it, it recomputes from `delegations` and compares.
 *
 * Wire shape: working/architecture.md 7.
 */

import type { Address, Hex } from "viem";
import type { Delegation } from "./chain.js";

export const HEADER_VERSION = 1;

/** Field name inside x402's `extensions{}`, namespaced so other sellers can ignore it. */
export const HEADER_EXTENSION_KEY = "authorityHeader";

export type AuthorityClaims = {
  /** Raw base-unit amount, as a decimal string. Never a JS number. */
  maxPerPeriod: string;
  periodSeconds: number;
  allowedSeller: Address;
  expiry: number;
};

export type AuthorityHeader = {
  version: number;
  agentId: string;
  chain: string;
  manifestCid: string;
  delegations: readonly Delegation[];
  claims: AuthorityClaims;
  signature: Hex;
};

export type HeaderProblem =
  | { kind: "wrongVersion"; message: string }
  | { kind: "wrongChain"; message: string }
  | { kind: "claimsMismatch"; message: string; field: keyof AuthorityClaims }
  | { kind: "expired"; message: string; expiry: number; now: number }
  | { kind: "wrongSeller"; message: string; allowed: Address; actual: Address }
  | { kind: "zeroCap"; message: string };

/**
 * Compare seller-computed claims against the ones the client asserted.
 *
 * `computed` comes from walking the delegation chain, never from the header
 * itself. If the two disagree the answer is deny, not prefer one of them.
 */
export function compareClaims(
  header: AuthorityHeader,
  computed: AuthorityClaims,
): HeaderProblem | null {
  if (header.version !== HEADER_VERSION) {
    return { kind: "wrongVersion", message: `header version ${header.version}, expected ${HEADER_VERSION}` };
  }
  if (header.claims.maxPerPeriod !== computed.maxPerPeriod) {
    return {
      kind: "claimsMismatch",
      field: "maxPerPeriod",
      message: `claimed ${header.claims.maxPerPeriod}, recomputed ${computed.maxPerPeriod}`,
    };
  }
  if (header.claims.periodSeconds !== computed.periodSeconds) {
    return {
      kind: "claimsMismatch",
      field: "periodSeconds",
      message: `claimed ${header.claims.periodSeconds}, recomputed ${computed.periodSeconds}`,
    };
  }
  if (header.claims.allowedSeller.toLowerCase() !== computed.allowedSeller.toLowerCase()) {
    return {
      kind: "claimsMismatch",
      field: "allowedSeller",
      message: "allowedSeller differs from the value in the delegation",
    };
  }
  if (header.claims.expiry !== computed.expiry) {
    return {
      kind: "claimsMismatch",
      field: "expiry",
      message: `claimed expiry ${header.claims.expiry}, recomputed ${computed.expiry}`,
    };
  }
  return null;
}

export function checkSellerAndExpiry(
  header: AuthorityHeader,
  seller: Address,
  now: number,
): HeaderProblem | null {
  if (header.claims.allowedSeller.toLowerCase() !== seller.toLowerCase()) {
    return {
      kind: "wrongSeller",
      message: "this delegation is not scoped to the seller being called",
      allowed: header.claims.allowedSeller,
      actual: seller,
    };
  }
  if (header.claims.expiry <= now) {
    return { kind: "expired", message: "delegation has expired", expiry: header.claims.expiry, now };
  }
  if (BigInt(header.claims.maxPerPeriod) <= 0n) {
    return { kind: "zeroCap", message: "cap is zero; nothing is authorized" };
  }
  return null;
}

/**
 * The slice an agent is allowed to see through a tool call.
 *
 * This is what makes S5 possible: the agent reads its own budget and decides,
 * rather than being told. Keep it small and numeric on purpose, so a model has
 * an obvious reason to obey it.
 */
export function authorityToolResult(header: AuthorityHeader) {
  return {
    chain: header.chain,
    maxPerPeriod: header.claims.maxPerPeriod,
    periodSeconds: header.claims.periodSeconds,
    allowedSeller: header.claims.allowedSeller,
    expiry: header.claims.expiry,
    note: "These are the limits your on-chain delegation actually enforces. Exceeding them reverts on-chain; it is not a soft warning.",
  } as const;
}
