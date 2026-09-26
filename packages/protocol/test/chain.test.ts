import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { createPublicClient, http } from "viem";
import { hashDelegation, hashCaveat, hashCaveatArray, type Delegation } from "../src/chain.js";
import { DTK, DTK_CONSTANTS, MONAD_TESTNET } from "../src/addresses.js";
import { delegationManagerAbi } from "../src/abi.js";

const client = createPublicClient({ transport: http(MONAD_TESTNET.rpc) });

/**
 * These are the fixtures whose hashes are hard-coded below. Each expected value
 * was produced by calling the LIVE DelegationManager.getDelegationHash on
 * Monad testnet, not by running our own code. That is the whole point: if our
 * encoder ever drifts from DTK, every signature silently breaks and only a
 * test that trusts the chain will catch it.
 */
const root = {
  delegate: "0x2222222222222222222222222222222222222222",
  delegator: "0x1111111111111111111111111111111111111111",
  authority: DTK_CONSTANTS.ROOT_AUTHORITY,
  caveats: [
    {
      enforcer: DTK.allowedTargets,
      terms: "0xdeadbeef",
      args: "0x" as Hex,
    },
  ],
  salt: 0n,
  signature: "0x",
} as const satisfies Delegation;

const child = {
  delegate: "0x3333333333333333333333333333333333333333",
  delegator: root.delegate,
  authority: "0x0000000000000000000000000000000000000000000000000000000000000000",
  caveats: [
    { enforcer: DTK.erc20PeriodTransfer, terms: "0xc0ffee", args: "0x1234" as Hex },
    { enforcer: DTK.allowedMethods, terms: "0xabcd", args: "0x" as Hex },
  ],
  salt: 42n,
  signature: "0x",
} as const satisfies Delegation;

const noCaveats = {
  delegate: "0x4444444444444444444444444444444444444444",
  delegator: "0x1111111111111111111111111111111111111111",
  authority: DTK_CONSTANTS.ROOT_AUTHORITY,
  caveats: [],
  salt: 7n,
  signature: "0x",
} as const satisfies Delegation;

async function onChainHash(d: Delegation): Promise<`0x${string}`> {
  const h = await client.readContract({
    address: DTK.delegationManager as `0x${string}`,
    abi: delegationManagerAbi,
    functionName: "getDelegationHash",
    args: [d],
  });
  if (typeof h !== "string") throw new Error("unexpected getDelegationHash return");
  return h as `0x${string}`;
}

describe("EncoderLib parity", () => {
  it("matches the live getDelegationHash for a single-caveat root delegation", async () => {
    expect(hashDelegation(root)).toBe(await onChainHash(root));
  });

  it("matches the live getDelegationHash for a two-caveat child delegation", async () => {
    expect(hashDelegation(child)).toBe(await onChainHash(child));
  });

  it("matches the live getDelegationHash for a delegation with no caveats", async () => {
    expect(hashDelegation(noCaveats)).toBe(await onChainHash(noCaveats));
  });

  it("excludes `args` from the caveat hash, as DTK does", () => {
    const withArgs = { ...root, caveats: [{ ...root.caveats[0]!, args: "0xdeadbeefdeadbeef" as Hex }] };
    const withoutArgs = { ...root, caveats: [{ ...root.caveats[0]!, args: "0x" as Hex }] };
    expect(hashDelegation(withArgs)).toBe(hashDelegation(withoutArgs));
  });

  it("is sensitive to `terms`, unlike `args`", () => {
    const a = root.caveats[0]!;
    expect(hashCaveat({ ...a, terms: "0x01" as Hex })).not.toBe(hashCaveat({ ...a, terms: "0x02" as Hex }));
  });

  it("hashes an empty caveat array as keccak256 of empty bytes", () => {
    expect(hashCaveatArray([])).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
  });

  it("changes when the salt changes", () => {
    expect(hashDelegation({ ...root, salt: 1n })).not.toBe(hashDelegation({ ...root, salt: 2n }));
  });
});
