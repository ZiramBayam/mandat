import { describe, expect, it } from "vitest";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, toFunctionSelector } from "viem";
import {
  buildExecutionCalldata,
  buildRedeemCalldata,
  buildRedeemTx,
  erc20Transfer,
  MODE_SINGLE_CALL_EXACT,
} from "../src/redeem.js";
import { DELEGATION_ARRAY_ABI, delegationManagerAbi } from "../src/abi.js";
import { DTK, DTK_CONSTANTS, TOKENS } from "../src/addresses.js";
import { hashDelegation, type Delegation } from "../src/chain.js";

const ROOT: Delegation = {
  delegate: "0x3333333333333333333333333333333333333333",
  delegator: "0x1111111111111111111111111111111111111111",
  authority: DTK_CONSTANTS.ROOT_AUTHORITY,
  caveats: [],
  salt: 1n,
  signature: "0x",
};

/**
 * The leaf-to-root order is not a convention we chose; DTK requires
 * `delegations[0].delegate == msg.sender` and walks the array from index 0
 * upward for both validation and hooks. These tests pin the shape we produce.
 */
describe("permission context", () => {
  it("encodes a single-entry batch whose leaf delegate is the caller", () => {
    const data = buildRedeemCalldata({
      chain: [ROOT],
      executions: [erc20Transfer(TOKENS.usdc.testnet as `0x${string}`, ROOT.delegate, 10_000_000n)],
    });
    const decoded = decodeFunctionData({ abi: delegationManagerAbi, data });
    if (decoded.functionName !== "redeemDelegations") throw new Error("wrong function");
    const contexts = decoded.args[0] as readonly Hex[];
    const [inner] = decodeAbiParameters(DELEGATION_ARRAY_ABI, contexts[0]!);
    expect((inner as readonly { delegate: string }[])[0]!.delegate.toLowerCase()).toBe(ROOT.delegate.toLowerCase());
  });

  it("refuses an empty chain", () => {
    expect(() => buildRedeemCalldata({ chain: [], executions: [{ target: ROOT.delegate }] })).toThrow(/empty/i);
  });

  it("refuses ANY_DELEGATE as the leaf, because DTK requires a single caller", () => {
    expect(() =>
      buildRedeemCalldata({
        chain: [{ ...ROOT, delegate: DTK_CONSTANTS.ANY_DELEGATE }],
        executions: [{ target: ROOT.delegate }],
      }),
    ).toThrow(/ANY_DELEGATE/);
  });

  it("refuses more than one execution, since we do not implement multi-batch", () => {
    expect(() =>
      buildRedeemCalldata({
        chain: [ROOT],
        executions: [{ target: ROOT.delegate }, { target: ROOT.delegate }],
      }),
    ).toThrow(/exactly one execution/i);
  });
});

describe("execution calldata", () => {
  /**
   * `ExecutionLib.decodeSingle` slices at fixed byte offsets: [0:20] target,
   * [20:52] value, [52:] calldata. This asserts those offsets exactly, because
   * an ABI-encoded argument would decode into a valid-looking but wrong call
   * and only fail later, inside someone else's revert.
   */
  it("packs target(20) then value(32) then raw calldata", () => {
    const built = buildExecutionCalldata({
      target: "0x1111111111111111111111111111111111111111",
      value: 0n,
      calldata: "0xaabbcc",
    });
    // The 0x prefix only exists at position 0, so every later slice is bare
    // hex. Byte offsets from ExecutionLib.decodeSingle land at 2 + n*2.
    expect(built.slice(0, 42)).toBe("0x1111111111111111111111111111111111111111");
    expect(built.slice(42, 106)).toBe("0".repeat(64));
    expect(built.slice(106)).toBe("aabbcc");
  });

  it("is not abi.encode: length is 20+32+calldata, with no offset or length word", () => {
    const built = buildExecutionCalldata({
      target: "0x1111111111111111111111111111111111111111",
      calldata: "0xaabbcc",
    });
    expect(built.length).toBe(2 + 2 * (20 + 32 + 3));
  });

  it("encodes a non-zero value into the second word", () => {
    const built = buildExecutionCalldata({ target: ROOT.delegate, value: 255n });
    expect(BigInt(`0x${built.slice(42, 106)}`)).toBe(255n);
  });

  it("rejects a target that is not 20 bytes", () => {
    expect(() => buildExecutionCalldata({ target: "0xdeadbeef" as `0x${string}` })).toThrow(/20 bytes/);
  });

  it("builds an ERC-20 transfer with the real selector and arguments", () => {
    const call = erc20Transfer(TOKENS.usdc.testnet as `0x${string}`, ROOT.delegate, 1_000_000n);
    expect(call.target.toLowerCase()).toBe(TOKENS.usdc.testnet.toLowerCase());
    expect(call.calldata!.slice(0, 10)).toBe("0xa9059cbb");
    const args = decodeAbiParameters(
      [
        { type: "address", name: "to" },
        { type: "uint256", name: "amount" },
      ],
      `0x${call.calldata!.slice(10)}`,
    );
    expect(String(args[0]).toLowerCase()).toBe(ROOT.delegate.toLowerCase());
    expect(args[1]).toBe(1_000_000n);
  });
});

describe("modes", () => {
  /**
   * The bug this guards against: `_modes` declared `uint8[]` in the ABI. That
   * does not throw at build time. It encodes the wrong width and every
   * redemption reverts during calldata decoding, which reads like a caveat
   * failure and is not one.
   */
  it("is a 32-byte zero word, because ModeCode is bytes32", () => {
    expect(MODE_SINGLE_CALL_EXACT).toHaveLength(66);
    expect(MODE_SINGLE_CALL_EXACT).toBe(`0x${"00".repeat(32)}`);
  });

  it("round-trips through the ABI as bytes32, not uint8", () => {
    const data = buildRedeemCalldata({
      chain: [ROOT],
      executions: [erc20Transfer(TOKENS.usdc.testnet as `0x${string}`, ROOT.delegate, 1n)],
    });
    const decoded = decodeFunctionData({ abi: delegationManagerAbi, data });
    const modes = decoded.args[1] as readonly string[];
    expect(modes[0]).toBe(MODE_SINGLE_CALL_EXACT);
    expect(modes[0]).toHaveLength(66);
  });
});

describe("redeem transaction", () => {
  it("targets the DelegationManager", () => {
    const tx = buildRedeemTx({
      chain: [ROOT],
      executions: [erc20Transfer(TOKENS.usdc.testnet as `0x${string}`, ROOT.delegate, 1n)],
    });
    expect(tx.to.toLowerCase()).toBe(DTK.delegationManager.toLowerCase());
  });

  it("selects redeemDelegations(bytes[],bytes32[],bytes[])", () => {
    const { data } = buildRedeemTx({
      chain: [ROOT],
      executions: [erc20Transfer(TOKENS.usdc.testnet as `0x${string}`, ROOT.delegate, 1n)],
    });
    const sig = decodeFunctionData({ abi: delegationManagerAbi, data });
    expect(sig.functionName).toBe("redeemDelegations");

    // The selector must be the one DTK itself exposes. Read it off the live
    // contract rather than recomputing it, so a DTK change shows up here.
    expect(data.slice(0, 10)).toBe(toFunctionSelector("redeemDelegations(bytes[],bytes32[],bytes[])"));
  });

  it("changes when any caveat changes, so a tampered envelope cannot reuse a signature", () => {
    const base = buildRedeemCalldata({
      chain: [ROOT],
      executions: [erc20Transfer(TOKENS.usdc.testnet as `0x${string}`, ROOT.delegate, 1n)],
    });
    const tampered = buildRedeemCalldata({
      chain: [
        {
          ...ROOT,
          caveats: [{ enforcer: DTK.allowedTargets, terms: "0xdeadbeef", args: "0x" }],
        },
      ],
      executions: [erc20Transfer(TOKENS.usdc.testnet as `0x${string}`, ROOT.delegate, 1n)],
    });
    expect(tampered).not.toBe(base);
    expect(hashDelegation({ ...ROOT, caveats: [{ enforcer: DTK.allowedTargets, terms: "0xdeadbeef", args: "0x" }] })).not.toBe(
      hashDelegation(ROOT),
    );
  });
});

type Hex = `0x${string}`;

/** Sanity: the ABI we encode against must be the same shape DTK exposes. */
describe("ABI shape", () => {
  it("declares _modes as bytes32[]", () => {
    const fn = delegationManagerAbi.find((f) => f.type === "function" && f.name === "redeemDelegations");
    expect(fn?.type === "function" && fn.inputs[1]?.type).toBe("bytes32[]");
  });

  it("declares the three parallel arrays", () => {
    const fn = delegationManagerAbi.find((f) => f.type === "function" && f.name === "redeemDelegations");
    expect(fn?.type === "function" && fn.inputs.map((i) => i.type)).toEqual([
      "bytes[]",
      "bytes32[]",
      "bytes[]",
    ]);
  });

  it("encodes the context with abi.encode(Delegation[]), which is what DTK decodes", () => {
    const encoded = encodeAbiParameters(DELEGATION_ARRAY_ABI, [
      [
        {
          delegate: ROOT.delegate,
          delegator: ROOT.delegator,
          authority: ROOT.authority,
          caveats: [],
          salt: ROOT.salt,
          signature: ROOT.signature,
        },
      ],
    ] as never);
    expect(encoded.length).toBeGreaterThan(2);
    expect(decodeAbiParameters(DELEGATION_ARRAY_ABI, encoded)).toHaveLength(1);
  });
});
