/**
 * The one place a `permissions` block becomes DTK caveats.
 *
 * Kept in its own package and its own function so the mapping in
 * working/architecture.md 5 has exactly one implementation. If the table there
 * and this code disagree, the table is wrong.
 */

import { encodeAbiParameters, parseAbiParameters, type Address, type Hex } from "viem";
import {
  CHECK_GRAPH,
  CHECK_IDENTITY,
  CHECK_MANIFEST,
  DTK,
  ZERO_HASH,
  encodeTerms,
} from "@mandat/protocol";
import { periodToSeconds, type Period, type Permissions } from "./manifest.js";

export type CompiledCaveat = { enforcer: Address; terms: Hex; args: Hex };

export type CompileInput = {
  permissions: Permissions;
  manifestHash: Hex;
  /** Zero for a root delegation. */
  parentDelegationHash?: Hex;
  delegate: Address;
  delegator: Address;
  salt: bigint;
  checks?: number;
};

export type Compiled = {
  caveats: CompiledCaveat[];
  terms: Hex;
  /** Everything a human should read before signing. */
  summary: {
    targets: Address[];
    selectors: Hex[];
    tokenCaps: { token: Address; perPeriod: string; periodSeconds: number }[];
    expiry: number;
    maxCalls: number | null;
    checks: string[];
  };
};

const PERIOD_TRANSFER_ABI = [
  { type: "uint256", name: "period" },
  { type: "uint256", name: "amount" },
] as const;

const TIMESTAMP_ABI = [{ type: "uint256", name: "timestamp" }] as const;
const LIMITED_CALLS_ABI = [{ type: "uint256", name: "limit" }] as const;
const ALLOWED_TARGETS_ABI = [{ type: "address[]", name: "targets" }] as const;
const ALLOWED_METHODS_ABI = [{ type: "bytes4[]", name: "selectors" }] as const;

export function compileEnvelope(input: CompileInput): Compiled {
  const { permissions, manifestHash } = input;
  const caveats: CompiledCaveat[] = [];

  const targets = permissions.contracts.map((c) => c.address);
  const selectors = permissions.contracts.flatMap((c) => c.methods);

  caveats.push({
    enforcer: DTK.allowedTargets,
    terms: encodeAbiParameters(ALLOWED_TARGETS_ABI, [targets]),
    args: "0x",
  });

  caveats.push({
    enforcer: DTK.allowedMethods,
    terms: encodeAbiParameters(ALLOWED_METHODS_ABI, [selectors]),
    args: "0x",
  });

  for (const token of permissions.tokens) {
    caveats.push({
      enforcer: DTK.erc20PeriodTransfer,
      terms: encodeAbiParameters(PERIOD_TRANSFER_ABI, [
        BigInt(periodToSeconds(token.period as Period)),
        BigInt(token.perPeriod),
      ]),
      args: encodeAbiParameters([{ type: "address", name: "token" }], [token.address]),
    });
  }

  const expirySeconds = periodToSeconds(permissions.expiry);
  caveats.push({
    enforcer: requireEnforcer("Timestamp", TIMESTAMP_ENFORCER),
    terms: encodeAbiParameters(TIMESTAMP_ABI, [BigInt(Math.floor(Date.now() / 1000) + expirySeconds)]),
    args: "0x",
  });

  if (permissions.maxCalls !== undefined) {
    caveats.push({
      enforcer: requireEnforcer("LimitedCalls", LIMITED_CALLS_ENFORCER),
      terms: encodeAbiParameters(LIMITED_CALLS_ABI, [BigInt(permissions.maxCalls)]),
      args: "0x",
    });
  }

  const parentHash = input.parentDelegationHash ?? ZERO_HASH;
  const checks = input.checks ?? (CHECK_MANIFEST | CHECK_GRAPH | CHECK_IDENTITY);
  const terms =
    checks & CHECK_MANIFEST
      ? encodeTerms({ checks, manifestHash, parentDelegationHash: parentHash })
      : encodeTerms({ checks, parentDelegationHash: parentHash });

  return {
    caveats,
    terms,
    summary: {
      targets,
      selectors,
      tokenCaps: permissions.tokens.map((t) => ({
        token: t.address,
        perPeriod: t.period,
        periodSeconds: periodToSeconds(t.period as Period),
      })),
      expiry: Math.floor(Date.now() / 1000) + expirySeconds,
      maxCalls: permissions.maxCalls ?? null,
      checks: describeChecksLocal(checks),
    },
  };
}

/**
 * Not yet resolved on Monad. See working/constraints.md OPEN-01: only three of
 * the five caveat enforcer addresses are verified.
 *
 * These are placeholders that MUST be resolved before any envelope is signed.
 * A zero address here would produce a caveat whose call silently fails, so we
 * refuse to compile instead. Fail-closed beats a demo that breaks on chain.
 */
const TIMESTAMP_ENFORCER: Address | null = null;
const LIMITED_CALLS_ENFORCER: Address | null = null;

function requireEnforcer(name: string, value: Address | null): Address {
  if (value === null) {
    throw new Error(
      `${name} enforcer address is unresolved on Monad. Set it after verifying on-chain ` +
        `(working/constraints.md OPEN-01). Refusing to compile an envelope that would fail on redemption.`,
    );
  }
  return value;
}

function describeChecksLocal(checks: number): string[] {
  const names: string[] = [];
  if (checks & CHECK_MANIFEST) names.push("MANIFEST");
  if (checks & CHECK_GRAPH) names.push("GRAPH");
  if (checks & CHECK_IDENTITY) names.push("IDENTITY");
  return names;
}

export { periodToSeconds, parseAbiParameters };
