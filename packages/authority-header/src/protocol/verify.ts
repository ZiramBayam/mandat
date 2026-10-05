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

import type { Address, Hex, PublicClient } from "viem";
import {
  DTK,
  checkSellerAndExpiry,
  compareClaims,
  delegationTypedDataHash,
  inspectChain,
  type AuthorityClaims,
  type AuthorityHeader,
} from "@mandat/protocol";
import { authorityRegistryAbi, delegationManagerAbi } from "../abi.js";

export type Tier = { name: string; priceUsdc: number };

export type CheckResult = { name: string; ok: boolean; detail: string };

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
  /** Deployed AuthorityRegistry. Required, never defaulted. */
  registry: Address;
  /** Deployed SkillAuthorityEnforcer, used to locate the manifest digest. */
  skillEnforcer: Address;
  tiers: readonly Tier[];
  now?: () => number;
};

const USDC_BASE_UNITS = 1_000_000;

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet. Refusing to guess: a wrong answer here means serving a resource to an unauthorized agent. See working/plan.md G8.`);
    this.name = "NotImplementedError";
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

  // 2. Chain state. Batched because the public testnet endpoint rate-limits
  //    eth_call to 25 rps, so batching is required, not an optimisation.
  const hashes = header.delegations.map((d) => delegationTypedDataHash(d));
  const manager = readManager(client);
  const registry = readRegistry(client, config.registry);

  const manifestDigest = manifestHashOf(header, config.skillEnforcer);
  if (manifestDigest === null) {
    checks.push({ name: "manifest", ok: false, detail: "no SkillAuthorityEnforcer caveat in the chain" });
    return fail("header carries no Mandat envelope; nothing to authorise against");
  }

  const [disabled, registered, live, manifestOk, agentId] = await Promise.all([
    Promise.all(hashes.map((h) => manager.disabled(h))),
    Promise.all(hashes.slice(1).map((h) => registry.isRegistered(h))),
    Promise.all(hashes.map((h) => registry.isLive(h))),
    registry.isLiveManifest(manifestDigest),
    registry.agentIdOf(caller),
  ]);

  const revokedHop = disabled.indexOf(true);
  checks.push({ name: "notRevoked", ok: revokedHop === -1, detail: revokedHop === -1 ? "all hops live" : `hop ${revokedHop} revoked` });
  if (revokedHop !== -1) return fail(`delegation hop ${revokedHop} is revoked`);

  const unknownHop = registered.indexOf(false);
  checks.push({
    name: "inGraph",
    ok: unknownHop === -1,
    detail: unknownHop === -1 ? "every hop registered" : `hop ${unknownHop + 1} not in AuthorityRegistry`,
  });
  if (unknownHop !== -1) return fail(`hop ${unknownHop + 1} is not in the authority graph`);

  const deadHop = live.indexOf(false);
  checks.push({ name: "live", ok: deadHop === -1, detail: deadHop === -1 ? "all live" : `hop ${deadHop} not live` });
  if (deadHop !== -1) return fail(`hop ${deadHop} is not live`);

  checks.push({ name: "manifest", ok: manifestOk, detail: manifestOk ? "manifest live" : "manifest unknown or revoked" });
  if (!manifestOk) return fail("manifest is not published or has been revoked");

  checks.push({ name: "identity", ok: agentId > 0n, detail: `agentId ${agentId.toString()}` });
  if (agentId === 0n) return fail("redeemer has no ERC-8004 identity");

  // 3. Recompute the claims from the caveats, then compare against what the
  //    client asserted. Until this is implemented we deny rather than trust.
  const computed = recomputeClaims(header);
  if (computed === null) {
    throw new NotImplementedError("recomputeClaims (decode ERC20PeriodTransfer and Timestamp caveat terms)");
  }
  const mismatch = compareClaims(header, computed);
  checks.push({ name: "claims", ok: mismatch === null, detail: mismatch?.message ?? "claims match recomputation" });
  if (mismatch !== null) return fail(mismatch.message);

  const scope = checkSellerAndExpiry(header, config.seller, now);
  checks.push({ name: "scope", ok: scope === null, detail: scope?.message ?? "scoped to this seller and unexpired" });
  if (scope !== null) return fail(scope.message);

  // 4. Tier decision, gated by the on-chain cap.
  const cap = BigInt(computed.maxPerPeriod);
  const affordable = config.tiers.filter((t) => BigInt(Math.round(t.priceUsdc * USDC_BASE_UNITS)) <= cap);
  const tier = affordable[affordable.length - 1];
  if (tier === undefined) {
    return {
      allowed: false,
      tier: null,
      reason: `no tier fits within the cap of ${computed.maxPerPeriod} base units`,
      elapsedMs: Date.now() - started,
      checks,
    };
  }
  return {
    allowed: true,
    tier,
    reason: `served ${tier.name} at ${tier.priceUsdc} USDC, within cap`,
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
        return decodeManifestHashFromTerms(caveat.terms);
      }
    }
  }
  return null;
}

function decodeManifestHashFromTerms(terms: Hex): Hex | null {
  // terms = abi.encode(uint8 version, uint8 checks, bytes32 manifestHash, bytes32 parent)
  const hex = terms.slice(2);
  if (hex.length !== 256) return null;
  return `0x${hex.slice(96, 160)}`;
}

function recomputeClaims(header: AuthorityHeader): AuthorityClaims | null {
  // TODO(plan.md G8): decode the ERC20PeriodTransfer and Timestamp caveat terms
  // from the leaf delegation and build the claims from those, then let
  // compareClaims() do its job. Returning the input here would make step 3 a
  // no-op that always passes, which is worse than not having it.
  void header;
  return null;
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
  };
}
