#!/usr/bin/env node
/**
 * Reference seller process.
 *
 * Two things make this honest rather than a mock:
 *  1. It never invents a payment result. It runs verifyAuthority() against real
 *     Monad state and denies when the check says deny.
 *  2. It holds the resource until the commit state reaches the tier's threshold,
 *     and withholds when the state is unknown. See working/architecture.md 8.
 *
 * Every refusal is recorded and signed. A seller that can quietly serve or
 * quietly deny is not auditable, and an audit record nobody can verify is not a
 * record. See `recordDecision` below.
 *
 * Nothing here is a shortcut. If the chain cannot be read, the answer is a 503
 * and not a guess; if the commit state is unknown, the answer is to withhold.
 */

import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { CommitIndex, MONAD_TESTNET, X402, mayRelease } from "@mandat/protocol";
import { signDecision, verifyAuthority, type SellerConfig, type SellerDecision, type Tier } from "../protocol/verify.js";
import { verifyPayment } from "../protocol/payment.js";
import { CommitFeed } from "@mandat/three-light";
import { DEMO_TIERS } from "./tiers.js";

const PORT = Number(process.env["SELLER_PORT"] ?? "4020");
const SELLER = (process.env["SELLER_ADDRESS"] ?? "0x0000000000000000000000000000000000000000") as Address;
const REGISTRY = (process.env["AUTHORITY_REGISTRY"] ?? "0x0000000000000000000000000000000000000000") as Address;
const ENFORCER = (process.env["SKILL_AUTHORITY_ENFORCER"] ?? "0x0000000000000000000000000000000000000000") as Address;
const ENFORCER_PERIOD = (process.env["ENFORCER_ERC20_PERIOD"] ?? "0x0000000000000000000000000000000000000000") as Address;
const ENFORCER_TIMESTAMP = (process.env["ENFORCER_TIMESTAMP"] ?? "0x0000000000000000000000000000000000000000") as Address;

/** Signing key for the audit trail. Separate from the pay-to address on purpose. */
const AUDIT_KEY = process.env["SELLER_AUDIT_PRIVATE_KEY"] as Hex | undefined;
const AUDIT_LOG = process.env["SELLER_AUDIT_LOG"] ?? "seller-decisions.jsonl";

const REQUIRED_ENV = {
  AUTHORITY_REGISTRY: REGISTRY,
  SKILL_AUTHORITY_ENFORCER: ENFORCER,
  ENFORCER_ERC20_PERIOD: ENFORCER_PERIOD,
  ENFORCER_TIMESTAMP: ENFORCER_TIMESTAMP,
};

const ZERO = "0x0000000000000000000000000000000000000000";
const missing = Object.entries(REQUIRED_ENV).filter(([, value]) => value === ZERO);
if (missing.length > 0) {
  process.stderr.write(
    `${missing.map(([name]) => name).join(", ")} must be set. The seller verifies against real\n` +
      "deployed contracts and refuses to run against placeholders.\n",
  );
  process.exit(1);
}

// `batch.multicall` is not an optimisation here: the public testnet endpoint
// rate-limits eth_call to 25 rps, and a four-hop chain is already more reads
// than that allows serially. See working/constraints.md 4.3.
const client = createPublicClient({ transport: http(MONAD_TESTNET.rpc), batch: { multicall: true } });

/**
 * One commit index, owned by @mandat/three-light.
 *
 * This used to open a second socket inline while @mandat/three-light existed to
 * do exactly this. Two subscriptions to the same feed means two views of
 * commitState, and the release decision must depend on one.
 */
const feed = new CommitFeed(MONAD_TESTNET);
feed.connect();

const commitIndex = new CommitIndex();
/**
 * Bridge the package's feed into the index the policy reads.
 *
 * Kept explicit rather than having CommitFeed expose its own index: the policy
 * functions operate on an index, and a second representation of "how final is
 * this block" is the exact failure this package exists to prevent.
 */
const unsubscribe = feed.subscribe((head) => {
  if (head !== null) commitIndex.ingest(head);
});

/**
 * Built per request because `requestedTier` is part of the decision: the same
 * seller, same registry, refuses the expensive dataset and serves the cheap one
 * purely on what was asked for.
 */
function configFor(tierName: string): SellerConfig {
  return {
  chainId: MONAD_TESTNET.chainId,
  seller: SELLER,
  requestedTier: tierName,
  registry: REGISTRY,
  skillEnforcer: ENFORCER,
  erc20PeriodEnforcer: ENFORCER_PERIOD,
  timestampEnforcer: ENFORCER_TIMESTAMP,
  tiers: DEMO_TIERS,
  };
}

/**
 * Prices are in base units of `CAP_TOKEN`, the same token the authority cap is
 * denominated in, and the same token `verifyPayment` looks for a transfer of.
 *
 * They were human-readable USDC before. That is the bug this comment is about: the
 * 402 challenge advertised `maxAmountRequired: 8000000` and the payment check
 * looked for a USDC transfer, while the tier that gates release is priced in WMON
 * base units. Three different numbers for one resource, and the cheapest of them
 * was the one on the wire. A client that paid the advertised amount in the
 * advertised token was not paying what the authority envelope authorised, and the
 * seller could not have detected it.
 *
 * There is no USDC on Monad testnet, so a USDC price was never collectable here in
 * the first place.
 */
type Resource = { name: string; body: string };

const RESOURCES: Record<string, Resource> = {
  "cheap-dataset": { name: "cheap-dataset", body: "a small, cheap answer" },
  "expensive-dataset": { name: "expensive-dataset", body: "a large, expensive answer" },
};

function tierFor(name: string): Tier {
  const tier = DEMO_TIERS.find((t) => t.name === name);
  if (tier === undefined) throw new Error(`no tier named ${name} in DEMO_TIERS`);
  return tier;
}

/**
 * Append a signed record of what was decided.
 *
 * Signed rather than merely logged because an audit record the seller can edit
 * after the fact is not evidence of anything. Without a key the record is still
 * written, but marked unsigned, so a missing key is visible rather than silent.
 */
async function recordDecision(entry: {
  path: string;
  allowed: boolean;
  decision: SellerDecision;
  paymentTx?: string | undefined;
  commitState?: string | undefined;
}): Promise<void> {
  const body = {
    at: new Date().toISOString(),
    resource: entry.path,
    allowed: entry.allowed,
    reason: entry.decision.reason,
    tier: entry.decision.tier?.name ?? null,
    elapsedMs: entry.decision.elapsedMs,
    checks: entry.decision.checks,
    paymentTx: entry.paymentTx ?? null,
    commitState: entry.commitState ?? null,
    seller: SELLER,
    chain: `eip155:${MONAD_TESTNET.chainId}`,
  };
  const line =
    AUDIT_KEY === undefined
      ? { ...body, signed: false, reason_unsigned: "SELLER_AUDIT_PRIVATE_KEY is not set" }
      : { ...body, ...(await signDecision(AUDIT_KEY, body)) };

  mkdirSync(".", { recursive: true });
  appendFileSync(AUDIT_LOG, `${JSON.stringify(line, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n`);
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        commitFeed: feed.connected,
        heads: feed.status().heads,
        finalFloor: feed.status().finalFloor,
        facilitator: X402.facilitator,
        auditLog: AUDIT_LOG,
        auditSigned: AUDIT_KEY !== undefined,
      }),
    );
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const resource = RESOURCES[url.pathname.slice(1)];
  if (resource === undefined) {
    res.writeHead(404).end("unknown resource");
    return;
  }

  /**
   * JSON with bigints rendered as decimal strings.
   *
   * `amount` comes off chain as a bigint, and a bare `JSON.stringify` throws on
   * one, which kills the request handler with no response at all. A dead handler is
   * the worst possible failure for a component whose job is to answer.
   */
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
  };

  // -- 1. Is there an Authority Header? If not, emit the 402 challenge.
  //       The header rides in the x402 extensions; it is read from its own header
  //       here so the challenge is produced before anything is verified.
  const raw = req.headers["x-authority-header"];
  if (typeof raw !== "string" || raw.length === 0) {
    const tier = tierFor(resource.name);
    res.writeHead(402, {
      "content-type": "application/json",
      "x-payment-required": JSON.stringify({
        chain: MONAD_TESTNET.chainId,
        facilitator: X402.facilitator,
        resource: resource.name,
        asset: tier.token,
        // The amount the authority envelope actually caps, in that token's base
        // units. Advertising anything else invites a client to pay a number that
        // has nothing to do with the authority it is asking to exercise.
        maxAmountRequired: tier.price.toString(),
        resourceName: resource.name,
        description: "Answer produced only after authority is verified and finality is reached.",
        mimeType: "application/json",
        payTo: SELLER,
        maxTimeoutSeconds: 60,
        extra: { [HEADER_EXTENSION_KEY]: { required: true } },
      }),
    });
    res.end("payment required");
    return;
  }

  // -- 2. Authority. A parse failure, a chain we do not read, a revoked hop or a
  //       tampered claim are all denials, not errors to shrug off.
  let decision: SellerDecision;
  try {
    decision = await verifyAuthority(client, JSON.parse(raw) as never, configFor(resource.name));
  } catch (error) {
    // The stack goes to stderr and not to the client. A 503 body is read by
    // whoever is probing the seller, and a stack trace tells them the shape of our
    // internals for nothing.
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    const message = error instanceof Error ? error.message : String(error);
    send(503, { error: message });
    // Recorded even though there is no decision object: a 503 is a decision not to
    // serve, and it is the kind that is easiest to hide.
    await recordDecision({
      path: url.pathname,
      allowed: false,
      decision: { allowed: false, tier: null, reason: message, elapsedMs: 0, checks: [] },
    });
    return;
  }

  if (!decision.allowed || decision.tier === null) {
    await recordDecision({ path: url.pathname, allowed: false, decision });
    send(403, decision);
    return;
  }

  // -- 3. Payment. The previous version only checked commit state when an
  //    `x-payment-tx` header was present and otherwise served the resource, which
  //    meant an unpaid request got the paid answer. Missing payment now withholds.
  const paymentTx = req.headers["x-payment-tx"];
  if (typeof paymentTx !== "string" || paymentTx.length === 0) {
    await recordDecision({ path: url.pathname, allowed: false, decision });
    send(425, { ...decision, withheld: true, reason: "no payment transaction supplied" });
    return;
  }

  const tier = tierFor(resource.name);
  let paid: { payer: Address; amount: bigint };
  try {
    paid = await verifyPayment(client, {
      paymentHeader: req.headers["x-payment"],
      settlementTx: paymentTx as Hex,
      payTo: SELLER,
      maxAmount: tier.price,
      token: tier.token,
      decimals: 18,
      // Half the ask. Below that the transfer is rounding, not payment, and the
      // authority envelope authorises the full price.
      minAmount: tier.price / 2n,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordDecision({ path: url.pathname, allowed: false, decision, paymentTx });
    send(402, { ...decision, withheld: true, reason: `payment not verified: ${message}` });
    return;
  }

  // -- 4. Finality. Unknown means withhold. A dropped socket must never look
  //       like "finalized", or a resource is released on a guess.
  const required = tier.releaseAt;
  const state = await feed.statusOf(
    (hash) => client.getTransactionReceipt({ hash: hash as Hex }),
    paymentTx,
  );
  if (!mayRelease(state, required)) {
    await recordDecision({
      path: url.pathname,
      allowed: false,
      decision,
      paymentTx,
      commitState: state ?? "unknown",
    });
    send(425, {
      ...decision,
      withheld: true,
      observedCommitState: state,
      requiredCommitState: required,
      paidBy: paid.payer,
      paidAmount: paid.amount.toString(),
    });
    return;
  }

  await recordDecision({
    path: url.pathname,
    allowed: true,
    decision,
    paymentTx,
    commitState: state ?? "unknown",
  });
  send(200, {
    ...decision,
    resource: resource.body,
    releasedAt: required,
    paidBy: paid.payer,
    paidAmount: paid.amount.toString(),
  });
});

const HEADER_EXTENSION_KEY = "authorityHeader";

server.listen(PORT, () => {
  process.stdout.write(
    `mandat seller on :${PORT} chain ${MONAD_TESTNET.chainId} (${MONAD_TESTNET.name})\n` +
      `  registry        ${REGISTRY}\n` +
      `  cap enforcer    ${ENFORCER_PERIOD}\n` +
      `  expiry enforcer ${ENFORCER_TIMESTAMP}\n` +
      `  payTo           ${SELLER}\n` +
      `  audit log       ${AUDIT_LOG}${AUDIT_KEY === undefined ? " (UNSIGNED: no key set)" : " (signed)"}\n`,
  );
});

process.on("SIGINT", () => {
  unsubscribe();
  feed.disconnect();
  server.close(() => process.exit(0));
});
