/**
 * Building a redemption.
 *
 * Nothing in this file exists anywhere else in the repo, and that was the
 * largest gap: `redeemDelegations` was declared in the ABI and called from
 * nowhere. Without this, the project's central claim, that a cap is enforced
 * on-chain rather than by our own middleware, had no code path at all.
 *
 * Every encoding here was read off the pinned DTK and erc7579 sources rather
 * than inferred from a type name. The three that are easy to get wrong:
 *
 *   - `_modes` is `ModeCode[]`, and `type ModeCode is bytes32`. Declaring it
 *     `uint8[]` makes every redemption revert during calldata decoding, which
 *     looks like a caveat failure and is not one.
 *
 *   - `_executionCallDatas` for a single execution is NOT `abi.encode`. It is
 *     a tight concatenation: 20-byte target, 32-byte value, then the raw
 *     calldata. `ExecutionLib.decodeSingle` slices it at fixed offsets, so an
 *     ABI-encoded argument would be read as garbage.
 *
 *   - `_permissionContexts` holds one abi-encoded `Delegation[]` per batch
 *     entry, ordered leaf to root, and `delegations[0].delegate` must be the
 *     caller. Order matters twice: DTK validates leaf-to-root, and it calls the
 *     hooks in that order too.
 */

import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  pad,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { DELEGATION_ARRAY_ABI, delegationManagerAbi } from "./abi.js";
import { DTK, DTK_CONSTANTS } from "./addresses.js";
import { type Delegation } from "./chain.js";

/**
 * CALLTYPE_SINGLE (0x00) | EXECTYPE_DEFAULT (0x00) | MODE_DEFAULT | payload 0,
 * per `ModeLib.encodeSimpleSingle`. Exectype DEFAULT means revert on failure,
 * which is what we want: an 80 USDC trade must revert loudly, not return an
 * empty receipt.
 */
export const MODE_SINGLE_CALL_EXACT = `0x${"00".repeat(32)}` as Hex;

export type SingleExecution = {
  target: Address;
  value?: bigint;
  calldata?: Hex;
};

/**
 * The single-execution encoding that `ExecutionLib.decodeSingle` expects:
 * bytes20 target | bytes32 value | raw calldata. Not abi.encode.
 */
export function buildExecutionCalldata(execution: SingleExecution): Hex {
  const target = execution.target.toLowerCase() as Hex;
  if (target.length !== 42) {
    throw new Error(`execution target ${execution.target} is not 20 bytes`);
  }
  return concat([
    target,
    pad(toQuantity(execution.value ?? 0n), { size: 32 }),
    execution.calldata ?? "0x",
  ]);
}

/**
 * One `Delegation[]` per batch entry, abi-encoded, leaf to root.
 *
 * `encodePermissionContext` in chain.ts already does the encoding; this is the
 * named wrapper the rest of the code uses so the ordering rule has one home.
 */
export function encodePermissionContexts(chain: readonly Delegation[]): Hex[] {
  if (chain.length === 0) {
    throw new Error("permission context is empty; there is nothing to redeem");
  }
  const leaf = chain[0];
  if (leaf === undefined) {
    throw new Error("permission context is empty; there is nothing to redeem");
  }
  if (leaf.delegate.toLowerCase() === DTK_CONSTANTS.ANY_DELEGATE.toLowerCase()) {
    throw new Error(
      "ANY_DELEGATE cannot redeem: DTK requires delegations[0].delegate == msg.sender, and an open leaf has no single caller",
    );
  }
  return [encodeAbiParameters(DELEGATION_ARRAY_ABI, [chain] as never)];
}

export type RedeemRequest = {
  /** Leaf to root. `chain[0].delegate` must be the account paying for gas. */
  chain: readonly Delegation[];
  executions: readonly SingleExecution[];
};

/**
 * Calldata for `DelegationManager.redeemDelegations`.
 *
 * Batching is positional: `_permissionContexts[i]`, `_modes[i]` and
 * `_executionCallDatas[i]` all describe batch entry i. We support one batch
 * entry because the caveats are per delegation and do not vary by execution;
 * more than one would mean the same delegation is checked against several
 * calls, which is a different feature and not one we claim.
 */
export function buildRedeemCalldata(request: RedeemRequest): Hex {
  const { chain, executions } = request;
  if (chain.length === 0) {
    throw new Error("cannot redeem an empty delegation chain");
  }
  if (executions.length === 0) {
    throw new Error("cannot redeem without an execution");
  }
  if (executions.length > 1) {
    throw new Error(
      `this builder takes exactly one execution, got ${executions.length}; see the note on batching above`,
    );
  }

  return encodeFunctionData({
    abi: delegationManagerAbi,
    functionName: "redeemDelegations",
    args: [
      encodePermissionContexts(chain),
      [MODE_SINGLE_CALL_EXACT],
      executions.map(buildExecutionCalldata),
    ],
  });
}

export function buildRedeemTx(request: RedeemRequest): { to: Address; data: Hex } {
  return {
    to: DTK.delegationManager as Address,
    data: buildRedeemCalldata(request),
  };
}

/** viem has no bigint-to-hex helper; keeping it here avoids a per-call import. */
function toQuantity(value: bigint): Hex {
  if (value < 0n) throw new Error("execution value cannot be negative");
  return `0x${value.toString(16).padStart(2, "0")}` as Hex;
}

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

/** An ERC-20 `transfer(to, amount)` call as a single execution. */
export function erc20Transfer(token: Address, to: Address, amount: bigint): SingleExecution {
  if (amount <= 0n) throw new Error("transfer amount must be positive");
  return {
    target: token,
    calldata: encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [to, amount],
    }),
  };
}

export { encodeAbiParameters };
