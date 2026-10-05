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

import { type Address, type Hex } from "viem";
import {
  CHECK_GRAPH,
  CHECK_IDENTITY,
  CHECK_MANIFEST,
  TERMS_VERSION,
  ZERO_ADDRESS,
  ZERO_HASH,
  describeChecks as describeCheckBits,
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
import { validatePermissions, type Permissions } from "./manifest.js";

export type CompiledCaveat = { enforcer: Address; terms: Hex; args: Hex };

export type CompileInput = {
  permissions: Permissions;
  manifestHash: Hex;
  /** Zero for a root delegation. */
  parentDelegationHash?: Hex;
  /**
   * Seller this envelope may be spent at. Zero, the default, means any seller:
   * a delegation minted for general use stays usable everywhere. Naming one makes
   * it exclusive, and a seller reads it back out of `terms` to refuse a request
   * from a delegation minted for somebody else.
   */
  allowedSeller?: Address;
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
    /** Zero means the envelope is not scoped to a single seller. */
    allowedSeller: Address;
  };
};

export function compileEnvelope(input: CompileInput): Compiled {
  const { permissions, manifestHash, enforcers } = input;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const caveats: CompiledCaveat[] = [];

  // Validated here as well as in parsePermissions. `compileEnvelope` is a public
  // export, so a caller can hand it a hand-built object and skip the parser
  // entirely. An envelope compiled from an unvalidated block could bind the
  // wrong chain, and that error surfaces on-chain at redemption rather than at
  // compile time.
  validatePermissions(permissions);

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
  const seller = input.allowedSeller ?? ZERO_ADDRESS;
  // The manifest digest only goes in when the MANIFEST check is on. `encodeTerms`
  // rejects the combination in both directions, so a caller cannot end up with
  // terms that carry a digest nobody checks.
  const encoded = encodeTerms({
    checks,
    ...(checks & CHECK_MANIFEST ? { manifestHash } : {}),
    parentDelegationHash: parentHash,
    allowedSeller: seller,
  });

  const caveatIndex = caveats.length - 1;
  caveats[caveatIndex] = { enforcer: enforcers.skillAuthority, terms: encoded, args: "0x" };

  return {
    caveats,
    terms: encoded,
    decodedTerms: {
      version: TERMS_VERSION,
      checks,
      manifestHash: checks & CHECK_MANIFEST ? manifestHash : ZERO_HASH,
      parentDelegationHash: parentHash,
      allowedSeller: seller,
    },
    summary: {
      targets,
      selectors,
      tokenCaps,
      notBefore: 0,
      notAfter,
      maxCalls,
      checks: describeCheckBits(checks),
      manifestHash: checks & CHECK_MANIFEST ? manifestHash : ZERO_HASH,
      allowedSeller: seller,
    },
  };
}

/**
 * Written to fixtures/<skill>/compiled.json and read by
 * contracts/test/CompiledEnvelope.t.sol, which decodes every term with the LIVE
 * enforcer's own getTermsInfo. abi-encoded so Solidity can decode the array
 * directly instead of hand-rolling a JSON parser.
 */
export function serialiseForChainTest(compiled: Compiled, enforcers: EnforcerAddresses): string {
  // Looked up by enforcer address, never by array position. `compileEnvelope`
  // pushes caveats conditionally: a manifest with no `maxCalls` produces five
  // caveats, not six. Positional indexing then read `limitedCalls` off the
  // skillAuthority slot, and the Solidity test would have decoded the wrong
  // terms under the wrong name without failing.
  const byEnforcer: Record<string, string> = {};
  for (const c of compiled.caveats) byEnforcer[c.enforcer.toLowerCase()] = c.terms;

  const lookup = (address: Address): string => byEnforcer[address.toLowerCase()] ?? "0x";

  return JSON.stringify(
    {
      caveats: compiled.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: c.args })),
      enforcers: {
        allowedTargets: lookup(enforcers.allowedTargets),
        allowedMethods: lookup(enforcers.allowedMethods),
        erc20PeriodTransfer: lookup(enforcers.erc20PeriodTransfer),
        timestamp: lookup(enforcers.timestamp),
        limitedCalls: lookup(enforcers.limitedCalls),
        skillAuthority: lookup(enforcers.skillAuthority),
      },
      caveatCount: compiled.caveats.length,
      terms: compiled.terms,
      summary: compiled.summary,
    },
    null,
    2,
  );
}

export { periodToSeconds };
