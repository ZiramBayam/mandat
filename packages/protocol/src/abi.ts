/**
 * ABIs we call or read. Kept minimal on purpose: only the functions Mandat
 * actually uses, so a DTK upgrade that changes something unused cannot break
 * us, and so the surface we depend on is visible in one file.
 *
 * `DelegationManager` has no `delegations(address,bytes32)` view in v1.3.0.
 * That is why the Authority Header must carry the full delegation chain.
 * Asserted in contracts/test/Smoke.t.sol and recorded in working/constraints.md 4.2.
 */

import type { Abi } from "viem";

export const caveatTuple = [
  { name: "enforcer", type: "address" },
  { name: "terms", type: "bytes" },
  { name: "args", type: "bytes" },
] as const;

export const delegationTuple = [
  { name: "delegate", type: "address" },
  { name: "delegator", type: "address" },
  { name: "authority", type: "bytes32" },
  { name: "caveats", type: "tuple[]", components: caveatTuple },
  { name: "salt", type: "uint256" },
  { name: "signature", type: "bytes" },
] as const;

/** A bare `tuple[]` with no components cannot be encoded by viem. */
export const DELEGATION_ARRAY_ABI = [{ type: "tuple[]", name: "delegations", components: delegationTuple }] as const;

export const delegationManagerAbi = [
  // NOTE: signature is omitted from the DELEGATION_TYPEHASH
  {
    type: "function",
    name: "redeemDelegations",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_permissionContexts", type: "bytes[]" },
      // `ModeCode[]`, and `type ModeCode is bytes32` (erc7579 ModeLib.sol:55).
      // `uint8[]` here would silently mis-encode the mode and every redemption
      // would revert on calldata decoding instead of on the caveat.
      { name: "_modes", type: "bytes32[]" },
      { name: "_executionCallDatas", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "enableDelegation",
    stateMutability: "nonpayable",
    inputs: [{ name: "_delegation", type: "tuple", components: delegationTuple }],
    outputs: [],
  },
  {
    type: "function",
    name: "disableDelegation",
    stateMutability: "nonpayable",
    inputs: [{ name: "_delegation", type: "tuple", components: delegationTuple }],
    outputs: [],
  },
  {
    type: "function",
    name: "disabledDelegations",
    stateMutability: "view",
    inputs: [{ name: "_delegationHash", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getDelegationHash",
    stateMutability: "pure",
    inputs: [{ name: "_input", type: "tuple", components: delegationTuple }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "getDomainHash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "ROOT_AUTHORITY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "ANY_DELEGATE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "RedeemedDelegation",
    inputs: [
      { name: "rootDelegator", type: "address", indexed: true },
      { name: "redeemer", type: "address", indexed: true },
      {
        name: "delegation",
        type: "tuple",
        components: delegationTuple,
        // The whole struct sits in data, not indexes. That is what lets the
        // explorer reconstruct the chain from logs alone, with no backend.
        indexed: false,
      },
    ],
  },
  // Shapes copied from DTK's own IDelegationManager. These were empty before,
  // which made them useless to the explorer: an event with no inputs cannot be
  // decoded, so a log-consumer reconstructing the chain from logs alone would
  // have had nothing to read.
  {
    type: "event",
    name: "EnabledDelegation",
    inputs: [
      { name: "delegationHash", type: "bytes32", indexed: true },
      { name: "delegator", type: "address", indexed: true },
      { name: "delegate", type: "address", indexed: true },
      { name: "delegation", type: "tuple", components: delegationTuple, indexed: false },
    ],
  },
  {
    type: "event",
    name: "DisabledDelegation",
    inputs: [
      { name: "delegationHash", type: "bytes32", indexed: true },
      { name: "delegator", type: "address", indexed: true },
      { name: "delegate", type: "address", indexed: true },
      { name: "delegation", type: "tuple", components: delegationTuple, indexed: false },
    ],
  },
  {
    type: "event",
    name: "SetDomain",
    inputs: [
      { name: "domainHash", type: "bytes32", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "domainVersion", type: "string", indexed: false },
      { name: "chainId", type: "uint256", indexed: false },
      { name: "contractAddress", type: "address", indexed: true },
    ],
  },
] as const satisfies Abi;

export const erc1271Abi = [
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [
      { name: "_hash", type: "bytes32" },
      { name: "_signature", type: "bytes" },
    ],
    outputs: [{ name: "magicValue", type: "bytes4" }],
  },
] as const satisfies Abi;

export const ERC1271_MAGIC_VALUE = "0x1626ba7e" as const;

/** Verifier we will deploy on testnet; addresses live in addresses.ts. */
const authorityMetaTuple = [
  { name: "delegator", type: "address" },
  { name: "delegate", type: "address" },
  { name: "agentId", type: "uint256" },
  { name: "parentHash", type: "bytes32" },
  { name: "manifestHash", type: "bytes32" },
  { name: "createdAt", type: "uint64" },
  { name: "revokedAt", type: "uint64" },
] as const;

export const authorityRegistryAbi = [
  {
    type: "function",
    name: "registerManifest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "manifestHash", type: "bytes32" },
      { name: "cid", type: "string" },
    ],
    outputs: [],
  },
  { type: "function", name: "revokeManifest", stateMutability: "nonpayable", inputs: [{ name: "manifestHash", type: "bytes32" }], outputs: [] },
  {
    type: "function",
    name: "bindAgent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "agentId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "bindAgentFromERC8004",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "ERC8004_IDENTITY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "descendantsOf",
    stateMutability: "view",
    inputs: [{ name: "delegationHash", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "revokeDelegation",
    stateMutability: "nonpayable",
    inputs: [{ name: "delegationHash", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "ROOT_AUTHORITY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "registerDelegation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "delegation", type: "tuple", components: delegationTuple },
      { name: "manifestHash", type: "bytes32" },
    ],
    outputs: [],
  },
  { type: "function", name: "isLive", stateMutability: "view", inputs: [{ name: "delegationHash", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "isRegistered", stateMutability: "view", inputs: [{ name: "delegationHash", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  {
    // The public mapping getter. Absent from this ABI until the explorer needed
    // it: buildLineage carried its own private copy of the shape, and two copies of
    // one tuple is exactly how a reader ends up with an ABI that cannot decode its
    // own registry.
    type: "function",
    name: "authorities",
    stateMutability: "view",
    inputs: [{ name: "delegationHash", type: "bytes32" }],
    outputs: [{ name: "", type: "tuple", components: authorityMetaTuple }],
  },
  { type: "function", name: "lineage", stateMutability: "view", inputs: [{ name: "delegationHash", type: "bytes32" }], outputs: [{ name: "", type: "tuple[]", components: authorityMetaTuple }] },
  { type: "function", name: "manifestCid", stateMutability: "view", inputs: [{ name: "manifestHash", type: "bytes32" }], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "agentIdOf", stateMutability: "view", inputs: [{ name: "agent", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "liveManifests", stateMutability: "view", inputs: [{ name: "manifestHash", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "delegationCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
] as const satisfies Abi;

export const identityRegistryAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "agentKey", type: "address", indexed: true },
      { name: "metadataURI", type: "string" },
    ],
  },
] as const satisfies Abi;

export { authorityMetaTuple };
