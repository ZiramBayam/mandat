/**
 * The one place a `permissions` block becomes DTK caveats.
 *
 * The mapping table in working/architecture.md 5 has exactly one implementation,
 * here. If the table and this code disagree, the table is wrong.
 *
 * The terms encodings are NOT abi.encode. Each built-in enforcer reads a bespoke
 * packed layout, and several reject the wrong length outright. See
 * @mandat/protocol/caveatTerms, and contracts/test/CompiledEnvelope.t.sol which
 * asserts every term against the live enforcer's own getTermsInfo().
 */

import { type Address, type Hex, parseAbiParameters } from "viem";
import {
  CHECK_GRAPH,
  CHECK_IDENTITY,
  CHECK_MANIFEST,
  ZERO_HASH,
  encodeAllowedMethods,
  encodeAllowedTargets,
  encodeERC20PeriodTransfer,
  encodeLimitedCalls,
  encodeTerms,
  encodeTimestamp,
  periodToSeconds,
  type Period,
  type Terms,
} from "@mandat/protocol";
import type { Permissions } from "./manifest.js";

export type CompiledCaveat = { enforcer: Address; terms: Hex; args: Hex };

export type CompileInput = {
  permissions: Permissions;
  manifestHash: Hex;
  /** Zero for a root delegation. */
  parentDelegationHash?: Hex;
  checks?: number;
  /** Injected so a compiled envelope is reproducible and testable. */
  now?: number;
  /** Caveat enforcer addresses. Deploy with script/DeployCaveatEnforcers.s.sol. */
  enforcers: EnforcerAddresses;
};

export type EnforcerAddresses = {
  allowedTargets: Address;
  allowedMethods: Address;
  erc20PeriodTransfer: Address;
  timestamp: Address;
  limitedCalls: Address;
  /** Our own, not a DTK builtin. */
  skillAuthority: Address;
};

export type Compiled = {
  caveats: CompiledCaveat[];
  terms: Hex;
  decodedTerms: Terms;
  summary: {
    targets: Address[];
    selectors: Hex[];
    tokenCaps: { token: Address; perPeriodBaseUnits: string; periodSeconds: number; startDate: number }[];
    notBefore: number;
    notAfter: number;
    maxCalls: number | null;
    checks: string[];
    manifestHash: Hex;
  };
};

export function compileEnvelope(input: CompileInput): Compiled {
  const { permissions, manifestHash, enforcers } = input;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const caveats: CompiledCaveat[] = [];

  const targets = permissions.contracts.map((c) => c.address);
  const selectors = permissions.contracts.flatMap((c) => c.methods);

  caveats.push({
    enforcer: enforcers.allowedTargets,
    terms: encodeAllowedTargets(targets),
    args: "0x",
  });

  caveats.push({
    enforcer: enforcers.allowedMethods,
    terms: encodeAllowedMethods(selectors),
    args: "0x",
  });

  // The token lives in the ERC20PeriodTransfer terms, not in args, and the
  // enforcer additionally requires the call target to equal that token.
  const tokenCaps = permissions.tokens.map((token) => {
    const periodSeconds = periodToSeconds(token.period as Period);
    const startDate = now;
    caveats.push({
      enforcer: enforcers.erc20PeriodTransfer,
      terms: encodeERC20PeriodTransfer({
        token: token.address,
        periodAmount: BigInt(token.perPeriod),
        periodDuration: BigInt(periodSeconds),
        startDate: BigInt(startDate),
      }),
      args: "0x",
    });
    return { token: token.address, perPeriodBaseUnits: token.perPeriod, periodSeconds, startDate };
  });

  const expirySeconds = periodToSeconds(permissions.expiry);
  const notAfter = now + expirySeconds;
  caveats.push({
    enforcer: enforcers.timestamp,
    terms: encodeTimestamp({ beforeThreshold: BigInt(notAfter) }),
    args: "0x",
  });

  let maxCalls: number | null = null;
  if (permissions.maxCalls !== undefined) {
    // maxCalls parses as a string so no integer in the manifest is ever rounded;
    // here it is a small count, so a number is the right type for the summary.
    maxCalls = Number(permissions.maxCalls);
    caveats.push({
      enforcer: enforcers.limitedCalls,
      terms: encodeLimitedCalls(BigInt(permissions.maxCalls)),
      args: "0x",
    });
  }

  caveats.push({
    enforcer: enforcers.skillAuthority,
    terms: ZERO_HASH, // replaced below
    args: "0x",
  });

  const checks = input.checks ?? (CHECK_MANIFEST | CHECK_GRAPH | CHECK_IDENTITY);
  const parentHash = input.parentDelegationHash ?? ZERO_HASH;
  const encoded =
    checks & CHECK_MANIFEST
      ? encodeTerms({ checks, manifestHash, parentDelegationHash: parentHash })
      : encodeTerms({ checks, parentDelegationHash: parentHash });

  const caveatIndex = caveats.length - 1;
  caveats[caveatIndex] = { enforcer: enforcers.skillAuthority, terms: encoded, args: "0x" };

  return {
    caveats,
    terms: encoded,
    decodedTerms: {
      version: 1,
      checks,
      manifestHash: checks & CHECK_MANIFEST ? manifestHash : ZERO_HASH,
      parentDelegationHash: parentHash,
    },
    summary: {
      targets,
      selectors,
      tokenCaps,
      notBefore: 0,
      notAfter,
      maxCalls,
      checks: describeChecks(checks),
      manifestHash: checks & CHECK_MANIFEST ? manifestHash : ZERO_HASH,
    },
  };
}

function describeChecks(checks: number): string[] {
  const names: string[] = [];
  if (checks & CHECK_MANIFEST) names.push("MANIFEST");
  if (checks & CHECK_GRAPH) names.push("GRAPH");
  if (checks & CHECK_IDENTITY) names.push("IDENTITY");
  return names;
}

/**
 * Written to fixtures/<skill>/compiled.json and read by
 * contracts/test/CompiledEnvelope.t.sol, which decodes every term with the LIVE
 * enforcer's own getTermsInfo. abi-encoded so Solidity can decode the array
 * directly instead of hand-rolling a JSON parser.
 */
export function serialiseForChainTest(compiled: Compiled): string {
  // Named keys rather than an array: forge-std's readBytes cannot decode a JSON
  // array, and a named field reads better in the Solidity test anyway.
  const byEnforcer: Record<string, string> = {};
  for (const c of compiled.caveats) byEnforcer[c.enforcer.toLowerCase()] = c.terms;

  return JSON.stringify(
    {
      caveats: compiled.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: c.args })),
      enforcers: {
        allowedTargets: byEnforcer[compiled.caveats[0]?.enforcer.toLowerCase() ?? ""] ?? "0x",
        allowedMethods: byEnforcer[compiled.caveats[1]?.enforcer.toLowerCase() ?? ""] ?? "0x",
        erc20PeriodTransfer: byEnforcer[compiled.caveats[2]?.enforcer.toLowerCase() ?? ""] ?? "0x",
        timestamp: byEnforcer[compiled.caveats[3]?.enforcer.toLowerCase() ?? ""] ?? "0x",
        limitedCalls: byEnforcer[compiled.caveats[4]?.enforcer.toLowerCase() ?? ""] ?? "0x",
        skillAuthority: byEnforcer[compiled.caveats[5]?.enforcer.toLowerCase() ?? ""] ?? "0x",
      },
      caveatCount: compiled.caveats.length,
      terms: compiled.terms,
      summary: compiled.summary,
    },
    null,
    2,
  );
}

export { periodToSeconds, parseAbiParameters };
