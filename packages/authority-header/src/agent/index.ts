/**
 * Agent side: build the Authority Header and redeem delegations.
 *
 * The agent holds a delegation, never a key it can spend beyond it. Everything
 * it does is either signed by the delegated authority or refused on-chain.
 */

import type { Address, Hex, PrivateKeyAccount } from "viem";
import {
  HEADER_EXTENSION_KEY,
  HEADER_VERSION,
  hashDelegation,
  type AuthorityClaims,
  type AuthorityHeader,
  type Delegation,
} from "@mandat/protocol";

export type BuildHeaderInput = {
  account: PrivateKeyAccount;
  chain: string;
  agentId: string;
  manifestCid: string;
  delegations: readonly Delegation[];
  claims: AuthorityClaims;
};

/**
 * The header signature covers the delegation hashes, so a seller can detect a
 * header whose `delegations` were swapped after signing.
 */
export type SignedAuthorityHeader = AuthorityHeader & { payloadHash: Hex; delegationHashes: readonly Hex[] };

export function buildAuthorityHeader(input: BuildHeaderInput): SignedAuthorityHeader {
  const hashes = input.delegations.map(hashDelegation);
  const payloadHash = hashDelegation({
    delegate: input.delegations[0]?.delegate ?? input.account.address,
    delegator: input.account.address,
    authority: input.delegations[0]?.authority ?? (`0x${"0".repeat(64)}` as Hex),
    caveats: [],
    salt: 0n,
    signature: "0x",
  });
  return {
    version: HEADER_VERSION,
    agentId: input.agentId,
    chain: input.chain,
    manifestCid: input.manifestCid,
    delegations: input.delegations,
    claims: input.claims,
    signature: "0x",
    payloadHash,
    delegationHashes: hashes,
  };
}

export function attachToExtensions<T extends Record<string, unknown>>(header: AuthorityHeader, extensions: T): T & Record<string, unknown> {
  return { ...extensions, [HEADER_EXTENSION_KEY]: header };
}

export type RedeemPlan = {
  redeemer: Address;
  /** Leaf to root, matching DTK's `_permissionContexts`. */
  permissionContext: readonly Delegation[];
  mode: number;
  executionCallData: Hex;
};

export const MODE_SINGLE_CALL_EXACT = 0;
