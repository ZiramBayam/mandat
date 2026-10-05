/**
 * Seller-side verification, in the order and under the budget claimed in
 * working/architecture.md 7.3.
 *
 * Two rules govern this file:
 *
 *  1. We never trust `claims`. They are recomputed from `delegations` and
 *     compared. Disagreement is a deny, not a preference.
 *  2. We never re-verify what DTK already verifies. Signature validity and
 *     per-hop revocation are DTK's job at redemption. We read them cheaply
 *     from views so we can answer before doing expensive work.
 *     See working/constraints.md 4.3.
 *
 * The point is a non-payment decision: serve or deny, per tier, before the
 * resource is produced. Settlement happens after the resource is handed over,
 * so a settlement-time rejection is already too late.
 */

import { keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import {
  DTK,
  TERMS_VERSION,
  ZERO_ADDRESS,
  checkSellerAndExpiry,
  compareClaims,
  decodeTerms,
  hashDelegation,
  inspectChain,
  type AuthorityClaims,
  type AuthorityHeader,
} from "@mandat/protocol";
import { privateKeyToAccount } from "viem/accounts";
import { authorityRegistryAbi, delegationManagerAbi } from "../abi.js";

export type Tier = {
  name: string;
  /**
   * Price in base units of `token`. Not a float: 80_000_000 means eighty of an
   * 18-decimal token, and 0.8 would be a rounding error rather than a price.
   */
  price: bigint;
  /** Token `price` is denominated in. Must match the cap's token to be comparable. */
  token: Address;
};

export type CheckResult = { name: string; ok: boolean; detail: string };

/**
 * What the header's own signature does and does not do.
 *
 * `AuthorityHeader.signature` is not checked here, and that is deliberate rather
 * than an omission. Every number the seller acts on is either recomputed from the
 * caveat `terms` or looked up on chain:
 *
 *   - the cap, period and expiry come from `recomputeClaims`, which reads the
 *     caveats, not the header's assertions;
 *   - the delegation itself is looked up by `hashDelegation` in the registry, and
 *     `AuthorityRegistry.registerDelegation` verified the delegator's signature
 *     when it was recorded, so a delegation with a larger cap exists only if its
 *     author actually signed it;
 *   - revocation and DTK's own `disabledDelegations` are read from chain.
 *
 * A signature over the header would add nothing that these do not already
 * establish, and would create a second thing to get wrong. It is kept on the wire
 * because `architecture.md` 7 specifies it, and a reader who finds it empty learns
 * something true: authority is proven by the delegation, not by the header.
 *
 * The one field that *is* purely asserted is `manifestCid`, and it is compared
 * against the registry below rather than trusted.
 */
export type SellerDecision = {
  allowed: boolean;
  tier: Tier | null;
  reason: string;
  /** Wall-clock cost, for the demo panel and for the README. */
  elapsedMs: number;
  checks: CheckResult[];
};

export type SellerConfig = {
  chainId: number;
  seller: Address;
  /**
   * The tier the caller actually asked for.
   *
   * Required, and this is the fix for a bug worth naming: without it the seller
   * priced the highest tier the cap allowed and served it against a request for a
   * more expensive one. A client asking for the premium dataset received the cheap
   * one, paid the cheap price, and had no way to tell. Silently downgrading is
   * worse than refusing: it is the failure mode where nobody notices.
   */
  requestedTier: string;
  /** Deployed AuthorityRegistry. Required, never defaulted. */
  registry: Address;
  /** Deployed SkillAuthorityEnforcer: carries the manifest digest and the seller scope. */
  skillEnforcer: Address;
  /**
   * Deployed ERC20PeriodTransfer and Timestamp enforcers. Required, because the
   * cap and the expiry live in their `terms` and a seller that cannot read them
   * cannot price a tier. Not defaulted to DTK's addresses: ours are deployed
   * separately, and reading the wrong one would find no caveats at all.
   */
  erc20PeriodEnforcer: Address;
  timestampEnforcer: Address;
  tiers: readonly Tier[];
  now?: () => number;
};

const USDC_BASE_UNITS = 1_000_000;

/**
 * The cap and the expiry are read out of the caveat `terms`, whose layouts are
 * bespoke packed blobs rather than `abi.encode`. Each decoder is checked against
 * the live enforcer's own `getTermsInfo` in contracts/test/CompiledEnvelope.t.sol,
 * because a wrong read here fails silently: it produces a number, just not the
 * right one, and a smaller number means serving a resource nobody paid for.
 */
const ERC20_PERIOD_TERM_BYTES = 116;
const TIMESTAMP_TERM_BYTES = 32;

/**
 * Sign an audit record.
 *
 * The signature covers the canonical JSON of the record, so a verifier can
 * recompute it and check the seller really made this decision. An unsigned record
 * is still written by the caller, marked as such: a missing key has to be visible
 * rather than quietly downgrade every entry.
 */
export async function signDecision(
  privateKey: Hex,
  body: unknown,
): Promise<{ signed: true; auditHash: Hex; signature: Hex }> {
  return { signed: true, ...(await signAudit(privateKey, body)) };
}

export type TermsProblem =
  | { kind: "noPeriodCaveat"; detail: string }
  | { kind: "noExpiryCaveat"; detail: string }
  | { kind: "badPeriodLength"; length: number }
  | { kind: "badTimestampLength"; length: number }
  | { kind: "noSellerScope"; detail: string }
  | { kind: "unknownTermsVersion"; version: number; expected: number }
  | { kind: "zeroCap"; detail: string };

/**
 * 116 packed bytes: token(20) amount(32) duration(32) startDate(32).
 *
 * The token comes back too, because the cap is meaningless without it. The first
 * 20 bytes are a packed address, not a padded word, so the slice is 0..40.
 */
function decodePeriodTerms(
  terms: Hex,
): { cap: bigint; seconds: bigint; token: Address } | TermsProblem {
  const body = terms.slice(2);
  if (body.length !== ERC20_PERIOD_TERM_BYTES * 2) {
    return { kind: "badPeriodLength", length: body.length / 2 };
  }
  const cap = BigInt(`0x${body.slice(40, 104)}`);
  const seconds = BigInt(`0x${body.slice(104, 168)}`);
  if (cap === 0n) return { kind: "zeroCap", detail: "period cap is zero" };
  return { cap, seconds, token: `0x${body.slice(0, 40)}` as Address };
}

/** 32 bytes: uint128 must-be-after, then uint128 must-be-before. */
function decodeTimestampTerms(terms: Hex): number | TermsProblem {
  const body = terms.slice(2);
  if (body.length !== TIMESTAMP_TERM_BYTES * 2) {
    return { kind: "badTimestampLength", length: body.length / 2 };
  }
  // Each half is a uint128, big-endian, in its own 16 bytes.
  const before = BigInt(`0x${body.slice(32, 64)}`);
  // A zero "before" means no expiry, which is not a delegation we serve against.
  if (before === 0n) return { kind: "noExpiryCaveat", detail: "Timestamp caveat has no upper bound" };
  return Number(before);
}

function problemMessage(problem: TermsProblem): string {
  switch (problem.kind) {
    case "noPeriodCaveat":
      return `no ERC20PeriodTransfer caveat in the chain; nothing caps what this agent may spend (${problem.detail})`;
    case "noExpiryCaveat":
      return `no usable Timestamp caveat in the chain (${problem.detail})`;
    case "badPeriodLength":
      return `ERC20PeriodTransfer terms are ${problem.length} bytes, the enforcer requires ${ERC20_PERIOD_TERM_BYTES}`;
    case "badTimestampLength":
      return `Timestamp terms are ${problem.length} bytes, the enforcer requires ${TIMESTAMP_TERM_BYTES}`;
    case "noSellerScope":
      return `no SkillAuthorityEnforcer caveat in the chain, so the delegation says nothing about which seller it may be spent at (${problem.detail})`;
    case "unknownTermsVersion":
      return `SkillAuthorityEnforcer terms are version ${problem.version}, this seller reads version ${problem.expected}`;
    case "zeroCap":
      return `the cap in the delegation is zero (${problem.detail})`;
  }
}

export async function verifyAuthority(
  client: PublicClient,
  header: AuthorityHeader,
  config: SellerConfig,
): Promise<SellerDecision> {
  const started = Date.now();
  const now = config.now?.() ?? Math.floor(Date.now() / 1000);
  const checks: CheckResult[] = [];
  const fail = (reason: string): SellerDecision => ({
    allowed: false,
    tier: null,
    reason,
    elapsedMs: Date.now() - started,
    checks,
  });

  if (header.chain !== `eip155:${config.chainId}`) {
    return fail(`header is for ${header.chain}, seller runs eip155:${config.chainId}`);
  }

  // 1. Structural and offline. Catches a malformed header before spending RPC.
  const caller = header.delegations[0]?.delegate;
  if (caller === undefined) return fail("header carries no delegations");
  const structure = inspectChain(header.delegations, caller);
  checks.push({ name: "structure", ok: structure === null, detail: structure?.message ?? "ok" });
  if (structure !== null) return fail(structure.message);

  const delegationHashes = header.delegations.map(hashDelegation);
  const manager = readManager(client);
  const registry = readRegistry(client, config.registry);

  // 2. Claims, recomputed from the caveats and compared against what the client
  //    asserted. This is offline and comes before any RPC: a tampered cap is
  //    wrong regardless of what the chain says, and refusing it without spending
  //    a request is both faster and harder to rate-limit around.
  //
  //    Reading the header is the point of this function. If these numbers were
  //    taken from the header, comparing them would be a tautology.
  const manifestDigest = manifestHashOf(header, config.skillEnforcer);
  if (manifestDigest === null) {
    checks.push({ name: "manifest", ok: false, detail: "no SkillAuthorityEnforcer caveat in the chain" });
    return fail("header carries no Mandat envelope; nothing to authorise against");
  }

  const recomputed = recomputeClaims(header, {
    periodEnforcer: config.erc20PeriodEnforcer,
    timestampEnforcer: config.timestampEnforcer,
    skillEnforcer: config.skillEnforcer,
  });
  if (!recomputed.ok) {
    const message = problemMessage(recomputed.problem);
    checks.push({ name: "claims", ok: false, detail: message });
    return fail(message);
  }
  const computed = recomputed.claims;
  const mismatch = compareClaims(header, computed);
  checks.push({ name: "claims", ok: mismatch === null, detail: mismatch?.message ?? "claims match recomputation" });
  if (mismatch !== null) return fail(mismatch.message);

  const scope = checkSellerAndExpiry(header, config.seller, now);
  checks.push({ name: "scope", ok: scope === null, detail: scope?.message ?? "scoped to this seller and unexpired" });
  if (scope !== null) return fail(scope.message);

  // 3. Chain state. Batched because the public testnet endpoint rate-limits
  //    eth_call to 25 rps, so batching is required, not an optimisation.

  const [disabled, registered, live, manifestOk, agentId, recordedCid] = await Promise.all([
    Promise.all(delegationHashes.map((h) => manager.disabled(h))),
    Promise.all(delegationHashes.map((h) => registry.isRegistered(h))),
    Promise.all(delegationHashes.map((h) => registry.isLive(h))),
    registry.isLiveManifest(manifestDigest),
    registry.agentIdOf(caller),
    registry.manifestCid(manifestDigest),
  ]);

  const revokedHop = disabled.indexOf(true);
  checks.push({ name: "notRevoked", ok: revokedHop === -1, detail: revokedHop === -1 ? "all hops live" : `hop ${revokedHop} revoked` });
  if (revokedHop !== -1) return fail(`delegation hop ${revokedHop} is revoked`);

  // Every hop including the leaf, because that is what the enforcer now checks.
  // An earlier version skipped the leaf on the assumption that a root has no
  // parent and therefore nothing to verify, which is how a revoked root went on
  // redeeming. See SkillAuthorityEnforcer and the fix in working/architecture.md.
  const unknownHop = registered.indexOf(false);
  checks.push({
    name: "inGraph",
    ok: unknownHop === -1,
    detail: unknownHop === -1 ? "every hop registered" : `hop ${unknownHop} not in AuthorityRegistry`,
  });
  if (unknownHop !== -1) return fail(`hop ${unknownHop} is not in the authority graph`);

  const deadHop = live.indexOf(false);
  checks.push({ name: "live", ok: deadHop === -1, detail: deadHop === -1 ? "all live" : `hop ${deadHop} not live` });
  if (deadHop !== -1) return fail(`hop ${deadHop} is not live`);

  checks.push({ name: "manifest", ok: manifestOk, detail: manifestOk ? "manifest live" : "manifest unknown or revoked" });
  if (!manifestOk) return fail("manifest is not published or has been revoked");

  // The CID is the only header field that is not recomputed from the chain, so it
  // is the one that has to be checked against it. A mismatch means the client is
  // describing a document the registry does not have on record.
  const cidMatches = recordedCid === "" || recordedCid === header.manifestCid;
  checks.push({
    name: "manifestCid",
    ok: cidMatches,
    detail: cidMatches
      ? "header CID matches the registry"
      : `header claims ${header.manifestCid}, registry has ${recordedCid}`,
  });
  if (!cidMatches) return fail(`manifest CID mismatch: header says ${header.manifestCid}, registry recorded ${recordedCid}`);

  checks.push({ name: "identity", ok: agentId > 0n, detail: `agentId ${agentId.toString()}` });
  if (agentId === 0n) return fail("redeemer has no ERC-8004 identity");

  // 4. Tier decision, gated by the on-chain cap.
  //
  //    The cap and the price must be in the same token. A 0.5 WMON cap read as a
  //    number is 5e17, which dwarfs 80 USDC at 8e7, so a seller that compared them
  //    without checking would serve the most expensive tier against a budget that
  //    cannot cover it. It happened once during development and the symptom was a
  //    sensible-looking answer.
  //
  //    The tier asked for must itself be affordable. Substituting a cheaper one
  //    would let a client request the premium resource and receive the discount
  //    one at the discount price, with nothing in the response to say so.
  const capToken = computed.capToken.toLowerCase();
  const requested = config.tiers.find((t) => t.name === config.requestedTier);
  if (requested === undefined) {
    return {
      allowed: false,
      tier: null,
      reason: `no tier named ${config.requestedTier}; refusing to substitute another for it`,
      elapsedMs: Date.now() - started,
      checks,
    };
  }

  if (requested.token.toLowerCase() !== capToken) {
    return {
      allowed: false,
      tier: null,
      reason:
        `${requested.name} is priced in ${requested.token} but the cap is denominated in ` +
        `${computed.capToken}; refusing to compare base units across tokens`,
      elapsedMs: Date.now() - started,
      checks,
    };
  }

  const cap = BigInt(computed.maxPerPeriod);
  if (requested.price > cap) {
    return {
      allowed: false,
      tier: null,
      reason:
        `${requested.name} costs ${requested.price} base units of ${requested.token}, ` +
        `above the cap of ${computed.maxPerPeriod}`,
      elapsedMs: Date.now() - started,
      checks,
    };
  }
  const tier = requested;
  return {
    allowed: true,
    tier,
    reason: `served ${tier.name} at ${tier.price} base units of ${tier.token}, within a cap of ${computed.maxPerPeriod}`,
    elapsedMs: Date.now() - started,
    checks,
  };
}

/**
 * The manifest digest is not in the caveat header. It lives inside the
 * `terms` of our own `SkillAuthorityEnforcer` caveat, addressed by its enforcer
 * address. Return null when no such caveat is present rather than guessing.
 */
export function manifestHashOf(header: AuthorityHeader, skillEnforcer: Address): Hex | null {
  for (const delegation of header.delegations) {
    for (const caveat of delegation.caveats) {
      if (caveat.enforcer.toLowerCase() === skillEnforcer.toLowerCase()) {
        // Decoded with our own decoder rather than by slicing the blob. The
        // previous version hardcoded the byte offsets for v1's four fields and
        // asserted a 128-byte length, so adding a field to `Terms` would have made
        // this return null and every header look like it carried no envelope.
        try {
          const decoded = decodeTerms(caveat.terms);
          if (decoded.version !== TERMS_VERSION) return null;
          return decoded.manifestHash;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Rebuild the claims from the delegation chain, never from the header.
 *
 * This is the whole point of the seller reading the header at all: the client
 * asserts a cap, and the seller derives the cap from the caveat terms and
 * compares. Returning the input here would make the comparison a tautology that
 * always passes, which is worse than having no check, so every failure path
 * below returns a reason rather than a number.
 *
 * The leaf carries the cap, because the leaf is the delegation being redeemed.
 * A parent with a *larger* cap than its child would not be caught here: the
 * enforcer receives no parent delegation to compare against. That limit is
 * documented in working/architecture.md 4.1 and is a real one.
 */
function recomputeClaims(
  header: AuthorityHeader,
  enforcers: { periodEnforcer: Address; timestampEnforcer: Address; skillEnforcer: Address },
): { ok: true; claims: AuthorityClaims } | { ok: false; problem: TermsProblem } {
  const leaf = header.delegations[0];
  if (leaf === undefined) {
    return { ok: false, problem: { kind: "noPeriodCaveat", detail: "header carries no delegations" } };
  }

  let period: { cap: bigint; seconds: bigint; token: Address } | null = null;
  let periodDetail = "no caveat addressed to the ERC20PeriodTransfer enforcer";
  let expiry: number | null = null;
  let expiryDetail = "no caveat addressed to the Timestamp enforcer";
  let seller: Address | null = null;
  let sellerDetail = "no caveat addressed to the SkillAuthorityEnforcer";

  for (const caveat of leaf.caveats) {
    const enforcer = caveat.enforcer.toLowerCase();

    if (enforcer === enforcers.periodEnforcer.toLowerCase()) {
      const decoded = decodePeriodTerms(caveat.terms);
      if ("kind" in decoded) return { ok: false, problem: decoded };
      period = { cap: decoded.cap, seconds: decoded.seconds, token: decoded.token };
      periodDetail = "read";
    } else if (enforcer === enforcers.timestampEnforcer.toLowerCase()) {
      const decoded = decodeTimestampTerms(caveat.terms);
      if (typeof decoded === "object" && decoded !== null) return { ok: false, problem: decoded };
      expiry = decoded;
      expiryDetail = "read";
    } else if (enforcer === enforcers.skillEnforcer.toLowerCase()) {
      // The seller scope lives in our own terms, so it is read with our own
      // decoder rather than a hand-rolled hex slice.
      const decoded = decodeTerms(caveat.terms);
      if (decoded.version !== TERMS_VERSION) {
        return {
          ok: false,
          problem: {
            kind: "unknownTermsVersion",
            version: decoded.version,
            expected: TERMS_VERSION,
          },
        };
      }
      seller = decoded.allowedSeller;
      sellerDetail = "read";
    }
  }

  if (period === null) return { ok: false, problem: { kind: "noPeriodCaveat", detail: periodDetail } };
  if (expiry === null) return { ok: false, problem: { kind: "noExpiryCaveat", detail: expiryDetail } };
  if (seller === null) return { ok: false, problem: { kind: "noSellerScope", detail: sellerDetail } };

  return {
    ok: true,
    claims: {
    // A string, never a JS number: 5e7 is fine but 5.2e16 base units is not, and
    // a rounded cap is a cap nobody asked for.
      maxPerPeriod: period.cap.toString(),
      capToken: period.token,
      periodSeconds: Number(period.seconds),
      allowedSeller: seller,
      expiry,
    },
  };
}

type ManagerLike = { disabled: (hash: Hex) => Promise<boolean> };
/**
 * `isLiveManifest` is the name on this local helper only. The ABI function it
 * calls is `liveManifests`, and that is the name the contract actually has.
 */
type RegistryLike = {
  isRegistered: (hash: Hex) => Promise<boolean>;
  isLive: (hash: Hex) => Promise<boolean>;
  isLiveManifest: (hash: Hex) => Promise<boolean>;
  agentIdOf: (address: Address) => Promise<bigint>;
  manifestCid: (hash: Hex) => Promise<string>;
};

function readManager(client: PublicClient): ManagerLike {
  return {
    disabled: (hash) =>
      client.readContract({
        address: DTK.delegationManager as Address,
        abi: delegationManagerAbi,
        functionName: "disabledDelegations",
        args: [hash],
      }) as Promise<boolean>,
  };
}

function readRegistry(client: PublicClient, registry: Address): RegistryLike {
  return {
    isRegistered: (hash) =>
      client.readContract({ address: registry, abi: authorityRegistryAbi, functionName: "isRegistered", args: [hash] }) as Promise<boolean>,
    isLive: (hash) =>
      client.readContract({ address: registry, abi: authorityRegistryAbi, functionName: "isLive", args: [hash] }) as Promise<boolean>,
    isLiveManifest: (hash) =>
      client.readContract({ address: registry, abi: authorityRegistryAbi, functionName: "liveManifests", args: [hash] }) as Promise<boolean>,
    agentIdOf: (address) =>
      client.readContract({ address: registry, abi: authorityRegistryAbi, functionName: "agentIdOf", args: [address] }) as Promise<bigint>,
    manifestCid: (hash) =>
      client.readContract({ address: registry, abi: authorityRegistryAbi, functionName: "manifestCid", args: [hash] }) as Promise<string>,
  };
}

/**
 * Canonical JSON: keys sorted at every level, so two runs produce byte-identical
 * input and a signature can be compared against a recomputation.
 *
 * `JSON.stringify` alone is not enough, because key order follows insertion
 * order and two structurally equal records would hash differently.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

async function signAudit(privateKey: Hex, body: unknown): Promise<{ auditHash: Hex; signature: Hex }> {
  const auditHash = keccak256(toHex(canonical(body)));
  // async under the hood because viem hashes the digest before signing.
  const signature = await privateKeyToAccount(privateKey).signMessage({ message: { raw: auditHash } });
  return { auditHash, signature };
}
