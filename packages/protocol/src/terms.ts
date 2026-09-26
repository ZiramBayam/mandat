/**
 * Encoding of the `terms` passed to `SkillAuthorityEnforcer`.
 *
 * This mirrors `Terms` in contracts/src/SkillAuthorityEnforcer.sol.
 * contracts/test/Terms.t.sol asserts both sides produce identical bytes.
 * If you change one, change the other, and the test will tell you if you forgot.
 *
 * Solidity:
 *   struct Terms {
 *       uint8   version;              // must be 1
 *       uint8   checks;               // bitmask, no unknown bits allowed
 *       bytes32 manifestHash;
 *       bytes32 parentDelegationHash; // 0x0 for a root delegation
 *   }
 *   abi.encode(Terms)  ->  128 bytes (every field padded to a 32-byte word)
 */

import { encodeAbiParameters, decodeAbiParameters, type Hex } from "viem";

export const TERMS_VERSION = 1;

export const CHECK_MANIFEST = 0b001;
export const CHECK_GRAPH = 0b010;
export const CHECK_IDENTITY = 0b100;
export const CHECK_ALL = CHECK_MANIFEST | CHECK_GRAPH | CHECK_IDENTITY;

export const CHECK_NAMES = {
  [CHECK_MANIFEST]: "MANIFEST",
  [CHECK_GRAPH]: "GRAPH",
  [CHECK_IDENTITY]: "IDENTITY",
} as const;

export const TERMS_ABI = [
  { type: "uint8", name: "version" },
  { type: "uint8", name: "checks" },
  { type: "bytes32", name: "manifestHash" },
  { type: "bytes32", name: "parentDelegationHash" },
] as const;

/** 4 fields x 32-byte words. `uint8` is NOT packed; abi.encode pads it. */
export const TERMS_LENGTH = 128;

export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

export type Terms = {
  version: number;
  checks: number;
  manifestHash: Hex;
  parentDelegationHash: Hex;
};

export class TermsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TermsError";
  }
}

/**
 * Fail-closed, matching the Solidity side. These are not conveniences: the
 * contract reverts on the same conditions, and a term that encodes here but
 * reverts on-chain is a bug we would only find in a demo.
 */
export function encodeTerms(input: {
  checks: number;
  manifestHash?: Hex;
  parentDelegationHash?: Hex;
  version?: number;
}): Hex {
  const version = input.version ?? TERMS_VERSION;
  const manifestHash = input.manifestHash ?? ZERO_HASH;
  const parentDelegationHash = input.parentDelegationHash ?? ZERO_HASH;

  if (version !== TERMS_VERSION) {
    throw new TermsError(`unsupported terms version ${version}, expected ${TERMS_VERSION}`);
  }
  if (!Number.isInteger(input.checks) || input.checks < 0 || input.checks > 0b111) {
    throw new TermsError(`unknown check bits in mask ${input.checks}`);
  }
  if ((input.checks & CHECK_MANIFEST) !== 0 && manifestHash === ZERO_HASH) {
    throw new TermsError("MANIFEST check set but manifestHash is zero");
  }
  if ((input.checks & CHECK_MANIFEST) === 0 && manifestHash !== ZERO_HASH) {
    throw new TermsError("manifestHash set but MANIFEST check is not enabled");
  }

  const encoded = encodeAbiParameters(TERMS_ABI, [version, input.checks, manifestHash, parentDelegationHash]);
  // Hex string length is 2 chars of `0x` plus 2 per byte.
  const byteLength = (encoded.length - 2) / 2;
  if (byteLength !== TERMS_LENGTH) {
    throw new TermsError(`unexpected terms length ${byteLength} bytes, expected ${TERMS_LENGTH}`);
  }
  return encoded;
}

export function decodeTerms(terms: Hex): Terms {
  const decoded = decodeAbiParameters(TERMS_ABI, terms);
  const [version, checks, manifestHash, parentDelegationHash] = decoded;
  if (version === undefined || checks === undefined || manifestHash === undefined || parentDelegationHash === undefined) {
    throw new TermsError("terms decoded to fewer fields than expected");
  }
  return { version, checks, manifestHash, parentDelegationHash };
}

/** Human-readable check list for CLI output and the explorer. */
export function describeChecks(checks: number): string[] {
  return Object.entries(CHECK_NAMES)
    .filter(([bit]) => (checks & Number(bit)) !== 0)
    .map(([, name]) => name);
}

export function isRoot(terms: Terms): boolean {
  return terms.parentDelegationHash === ZERO_HASH;
}
