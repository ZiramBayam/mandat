/**
 * Encoding of the `terms` passed to `SkillAuthorityEnforcer`.
 *
 * This mirrors `Terms` in contracts/src/SkillAuthorityEnforcer.sol.
 * contracts/test/CompiledEnvelope.t.sol asserts both sides agree, by decoding
 * our bytes with the live enforcer's own view.
 *
 * Solidity:
 *   struct Terms {
 *       uint8   version;              // must be 2
 *       uint8   checks;               // bitmask, no unknown bits allowed
 *       bytes32 manifestHash;
 *       bytes32 parentDelegationHash; // 0x0 for a root delegation
 *       address allowedSeller;       // 0x0 means "any seller"
 *   }
 *   abi.encode(Terms)  ->  160 bytes (one 32-byte word per field)
 *
 * Version 2 added `allowedSeller`. In v1 there was no seller in `terms` at all,
 * so a seller could only compare a value the client asserted, which is a
 * self-comparison rather than a check. Length is asserted rather than assumed,
 * because a v1 blob decoded as v2 would widen what the delegation permits.
 */

import { encodeAbiParameters, decodeAbiParameters, type Address, type Hex } from "viem";

export const TERMS_VERSION = 2;

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
  { type: "address", name: "allowedSeller" },
] as const;

/** 5 fields x 32-byte words. `uint8` is NOT packed; abi.encode pads it. */
export const TERMS_LENGTH = 160;

export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export type Terms = {
  version: number;
  checks: number;
  manifestHash: Hex;
  parentDelegationHash: Hex;
  /** Zero means the delegation is not scoped to any particular seller. */
  allowedSeller: Address;
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
  /** Omit for "any seller". */
  allowedSeller?: Address;
  version?: number;
}): Hex {
  const version = input.version ?? TERMS_VERSION;
  const manifestHash = input.manifestHash ?? ZERO_HASH;
  const parentDelegationHash = input.parentDelegationHash ?? ZERO_HASH;
  // Exact zero, not just falsy: an unset address must be the 20 zero bytes, and
  // `undefined` becoming `0x0000...0000` silently would let a typo widen scope.
  const allowedSeller = input.allowedSeller ?? ZERO_ADDRESS;
  if (!/^0x[0-9a-fA-F]{40}$/.test(allowedSeller)) {
    throw new TermsError(`allowedSeller ${allowedSeller} is not an address`);
  }

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

  const encoded = encodeAbiParameters(TERMS_ABI, [
    version,
    input.checks,
    manifestHash,
    parentDelegationHash,
    allowedSeller,
  ]);
  // Hex string length is 2 chars of `0x` plus 2 per byte.
  const byteLength = (encoded.length - 2) / 2;
  if (byteLength !== TERMS_LENGTH) {
    throw new TermsError(`unexpected terms length ${byteLength} bytes, expected ${TERMS_LENGTH}`);
  }
  return encoded;
}

export function decodeTerms(terms: Hex): Terms {
  const decoded = decodeAbiParameters(TERMS_ABI, terms);
  const [version, checks, manifestHash, parentDelegationHash, allowedSeller] = decoded;
  if (
    version === undefined ||
    checks === undefined ||
    manifestHash === undefined ||
    parentDelegationHash === undefined ||
    allowedSeller === undefined
  ) {
    throw new TermsError("terms decoded to fewer fields than expected");
  }
  return { version, checks, manifestHash, parentDelegationHash, allowedSeller };
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
