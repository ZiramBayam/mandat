/**
 * Reconstructing the authority chain, and the things we must not claim.
 *
 * DTK already validates the chain inside `redeemDelegations`: leaf-to-root
 * linkage, `disabledDelegations` per hop, root `authority == ROOT_AUTHORITY`,
 * and signatures (ECDSA for codeless delegators, ERC-1271 otherwise).
 * We do not re-verify any of that and we do not present it as ours.
 * See working/constraints.md 4.3 for the exact list.
 */

import { type Abi, type Address, type Hex, decodeAbiParameters, encodeAbiParameters, keccak256, concat, toHex } from "viem";
import { authorityRegistryAbi, delegationManagerAbi, erc1271Abi, ERC1271_MAGIC_VALUE } from "./abi.js";
import { DTK_CONSTANTS } from "./addresses.js";

export type Caveat = { enforcer: Address; terms: Hex; args: Hex };

export type Delegation = {
  delegate: Address;
  delegator: Address;
  authority: Hex;
  caveats: readonly Caveat[];
  salt: bigint;
  signature: Hex;
};

export type AuthorityMeta = {
  delegator: Address;
  delegate: Address;
  agentId: bigint;
  parentHash: Hex;
  manifestHash: Hex;
  createdAt: bigint;
  revokedAt: bigint;
};

const DELEGATION_TYPE_SIGNATURE =
  "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)";
const CAVEAT_TYPE_SIGNATURE = "Caveat(address enforcer,bytes terms)";

/**
 * keccak256(abi.encode(CAVEAT_TYPEHASH, enforcer, keccak256(terms)))
 *
 * `args` is excluded, and `terms` is hashed before use. Both are easy to get
 * wrong and neither is guessable from the type string.
 */
export function hashCaveat(caveat: Caveat): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32", name: "caveatTypehash" },
        { type: "address", name: "enforcer" },
        { type: "bytes32", name: "termsHash" },
      ],
      [keccak256(toHex(CAVEAT_TYPE_SIGNATURE)), caveat.enforcer, keccak256(caveat.terms)],
    ),
  );
}

/** keccak256(abi.encodePacked(packetHashes)) -- tight 32-byte concatenation, NOT abi.encode. */
export function hashCaveatArray(caveats: readonly Caveat[]): Hex {
  if (caveats.length === 0) {
    return keccak256("0x");
  }
  return keccak256(concat(caveats.map(hashCaveat)));
}

/**
 * Mirrors `EncoderLib._getDelegationHash` in DTK v1.3.0.
 *
 * Note the caveat array is folded into a single bytes32 first. Encoding the
 * caveats as a plain ABI `tuple[]` instead produces a different hash and every
 * signature would fail. Cross-checked against the live `getDelegationHash` in
 * test/chain.test.ts.
 */
export function hashDelegation(delegation: Delegation): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32", name: "delegationTypehash" },
        { type: "address", name: "delegate" },
        { type: "address", name: "delegator" },
        { type: "bytes32", name: "authority" },
        { type: "bytes32", name: "caveatArrayPacketHash" },
        { type: "uint256", name: "salt" },
      ],
      [
        keccak256(toHex(DELEGATION_TYPE_SIGNATURE)),
        delegation.delegate,
        delegation.delegator,
        delegation.authority,
        hashCaveatArray(delegation.caveats),
        delegation.salt,
      ],
    ),
  );
}

/** The exact digest the delegator signs. */
export function delegationTypedDataHash(delegation: Delegation, domainHash: Hex = DTK_CONSTANTS.domainHash): Hex {
  return keccak256(concat(["0x1901", domainHash, hashDelegation(delegation)]));
}

export function encodePermissionContext(chain: readonly Delegation[]): Hex {
  return encodeAbiParameters([{ type: "tuple[]", name: "delegations" }], [chain] as never);
}

export type ChainProblem =
  | { kind: "empty"; message: string }
  | { kind: "callerNotLeaf"; message: string }
  | { kind: "brokenLink"; message: string; index: number }
  | { kind: "rootAuthority"; message: string };

/**
 * Structural checks that are cheap and offline. Deliberately does NOT check
 * revocation or signature validity: those are read from chain, and DTK already
 * enforces them. This exists to catch a malformed header before we spend RPC
 * calls on it, and to give the seller a precise reason to deny.
 *
 * `chain` must be ordered leaf to root, matching DTK's `_permissionContexts`.
 */
export function inspectChain(chain: readonly Delegation[], caller: Address): ChainProblem | null {
  const leaf = chain[0];
  if (leaf === undefined) {
    return { kind: "empty", message: "permission context is empty" };
  }
  if (leaf.delegate.toLowerCase() !== caller.toLowerCase() && leaf.delegate.toLowerCase() !== DTK_CONSTANTS.ANY_DELEGATE) {
    return {
      kind: "callerNotLeaf",
      message: `caller ${caller} is not the leaf delegate ${leaf.delegate}`,
    };
  }
  for (let i = 0; i < chain.length - 1; i += 1) {
    const current = chain[i];
    const parent = chain[i + 1];
    if (current === undefined || parent === undefined) continue;
    if (current.authority.toLowerCase() !== hashDelegation(parent).toLowerCase()) {
      return { kind: "brokenLink", index: i, message: `hop ${i} authority does not point at its parent` };
    }
    if (parent.delegate.toLowerCase() !== DTK_CONSTANTS.ANY_DELEGATE && current.delegator.toLowerCase() !== parent.delegate.toLowerCase()) {
      return { kind: "brokenLink", index: i, message: `hop ${i} delegator is not the parent delegate` };
    }
  }
  const root = chain[chain.length - 1];
  if (root !== undefined && root.authority.toLowerCase() !== DTK_CONSTANTS.ROOT_AUTHORITY.toLowerCase()) {
    return { kind: "rootAuthority", message: "root delegation authority is not ROOT_AUTHORITY" };
  }
  return null;
}

/** What a caller needs beyond the rows, so an incomplete answer is never mistaken for a complete one. */
export type LineageResult = {
  /** Root first, leaf last. Empty when the leaf is not in the graph. */
  chain: AuthorityMeta[];
  /**
   * True when the walk stopped because it hit `maxDepth` rather than a root.
   *
   * A truncated chain is dangerous in this specific context: it looks like a short
   * authority path, and a reader would report it as "human, then agent" when the
   * real answer has more hops above.
   */
  truncated: boolean;
};

/**
 * Walk parentHash upward to answer "who authorised this, through whom".
 *
 * Two things the previous version got wrong, both silent:
 *
 *  - It stopped on a zero `parentHash`. A root delegation stores ROOT_AUTHORITY
 *    there, not zero, so the walk read `authorities(ROOT_AUTHORITY)`, got an
 *    all-zero tuple back, pushed that as a real hop, and stopped on the next
 *    round. The result ended with a fabricated entry for a delegation that does not
 *    exist.
 *
 *  - It tested `meta === undefined`. `readContract` on a missing mapping key
 *    returns a zeroed tuple, never undefined, so the walk had no early exit at all.
 *
 * Both are why this had no callers: the output looked plausible and was wrong.
 */
export async function buildLineage(
  registry: { readContract: (args: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }) => Promise<unknown> },
  registryAddress: Address,
  leafHash: Hex,
  maxDepth = 16,
  rootAuthority: Hex = DTK_CONSTANTS.ROOT_AUTHORITY,
): Promise<LineageResult> {
  const out: AuthorityMeta[] = [];
  let cursor: Hex | undefined = leafHash;

  for (let depth = 0; depth < maxDepth && cursor !== undefined; depth += 1) {
    const meta = (await registry.readContract({
      address: registryAddress,
      abi: authorityRegistryAbi,
      functionName: "authorities",
      args: [cursor],
    })) as AuthorityMeta | undefined;

    // A missing row reads as all zeroes, so test the field the contract uses to
    // decide a row exists rather than testing the tuple.
    if (meta === undefined || isZeroAddress(meta.delegator)) break;

    out.push(meta);

    // ROOT_AUTHORITY is the end of the chain, not another delegation to look up.
    if (meta.parentHash === rootAuthority) {
      cursor = undefined;
      break;
    }
    if (meta.parentHash === ZERO_HASH) {
      // A root with a zero parent is a registry written by something that is not
      // ours. Stop rather than follow it, and let the caller see a short chain.
      cursor = undefined;
      break;
    }
    cursor = meta.parentHash;
  }

  return { chain: out.reverse(), truncated: cursor !== undefined };
}

function isZeroAddress(value: Address): boolean {
  return /^0x0{40}$/i.test(value);
}

const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

export { decodeAbiParameters, delegationManagerAbi, erc1271Abi, ERC1271_MAGIC_VALUE };
