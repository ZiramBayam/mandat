/**
 * Re-exported so the seller and the agent cannot drift on ABI.
 * The real definitions live in @mandat/protocol, which is the single source
 * of truth. This file exists only to keep import paths short.
 */
export {
  authorityRegistryAbi,
  delegationManagerAbi,
  erc1271Abi,
  identityRegistryAbi,
  ERC1271_MAGIC_VALUE,
} from "@mandat/protocol";
