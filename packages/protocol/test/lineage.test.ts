import { describe, expect, it } from "vitest";
import type { Abi, Address, Hex } from "viem";
import { buildLineage, hashDelegation, type Delegation } from "../src/chain.js";
import { DTK_CONSTANTS } from "../src/addresses.js";

/**
 * A stand-in for the registry's `authorities` mapping.
 *
 * Rows are keyed by delegation hash, because that is how the real contract stores
 * them. A key that is absent has to behave the way `eth_call` behaves, which is the
 * whole point: a real readContract returns a zeroed tuple for a missing mapping
 * key, and code that checks for `undefined` instead of checking the field will walk
 * straight off the end of the graph.
 */
function fakeRegistry(rows: Record<string, { delegator: Address; parentHash: Hex }>) {
  const calls: string[] = [];
  return {
    calls,
    readContract: async ({ args }: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }) => {
      const key = String(args[0]);
      calls.push(key);
      const row = rows[key];
      if (row === undefined) {
        return {
          delegator: "0x0000000000000000000000000000000000000000",
          delegate: "0x0000000000000000000000000000000000000000",
          agentId: 0n,
          parentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          manifestHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          createdAt: 0n,
          revokedAt: 0n,
        };
      }
      return {
        delegator: row.delegator,
        delegate: "0x0000000000000000000000000000000000000001",
        agentId: 1042n,
        parentHash: row.parentHash,
        manifestHash: `0x${"11".repeat(32)}`,
        createdAt: 1_791_000_000n,
        revokedAt: 0n,
      };
    },
  };
}

const ROOT = DTK_CONSTANTS.ROOT_AUTHORITY;
const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;
const C = "0x3333333333333333333333333333333333333333" as Address;

const REGISTRY = "0x4444444444444444444444444444444444444444" as Address;

function delegation(authority: Hex, salt: bigint): Delegation {
  return {
    delegate: C,
    delegator: B,
    authority,
    caveats: [],
    salt,
    signature: "0x",
  };
}

describe("buildLineage", () => {
  /**
   * The regression. A root stores ROOT_AUTHORITY as its parent, so a walk that
   * stopped on a zero parent instead read `authorities(ROOT_AUTHORITY)`, got an
   * all-zero tuple back, appended it as a real hop, and stopped. The caller got a
   * chain with a fabricated delegation in it.
   */
  it("stops at ROOT_AUTHORITY without inventing a hop", async () => {
    const root = delegation(ROOT, 1n);
    const rootHash = hashDelegation(root);
    const registry = fakeRegistry({ [rootHash]: { delegator: A, parentHash: ROOT } });

    const result = await buildLineage(registry, REGISTRY, rootHash);

    expect(result.chain).toHaveLength(1);
    expect(result.chain[0]?.delegator.toLowerCase()).toBe(A.toLowerCase());
    expect(result.truncated).toBe(false);
    // Exactly one read. The old version made a second, pointless one.
    expect(registry.calls).toEqual([rootHash]);
  });

  it("returns root to leaf for a two-hop chain", async () => {
    const root = delegation(ROOT, 1n);
    const rootHash = hashDelegation(root);
    const child = delegation(rootHash, 2n);
    const childHash = hashDelegation(child);
    const registry = fakeRegistry({
      [rootHash]: { delegator: A, parentHash: ROOT },
      [childHash]: { delegator: B, parentHash: rootHash },
    });

    const result = await buildLineage(registry, REGISTRY, childHash);

    expect(result.chain.map((m) => m.delegator.toLowerCase())).toEqual([A.toLowerCase(), B.toLowerCase()]);
    expect(result.truncated).toBe(false);
  });

  it("returns an empty chain for a leaf nobody registered", async () => {
    const registry = fakeRegistry({});
    const result = await buildLineage(registry, REGISTRY, `0x${"99".repeat(32)}` as Hex);
    expect(result.chain).toHaveLength(0);
  });

  /**
   * A chain that keeps going past the bound is a short answer to "who authorised
   * this", and a short answer here looks like a real, short authority path. The
   * caller has to be able to tell the difference.
   */
  it("reports truncation instead of returning a short chain as if it were complete", async () => {
    // A cycle: root points at child, child points at root. Impossible through
    // registerDelegation, which requires the parent to exist first, and exactly why
    // the bound is cheap insurance.
    const rootHash = `0x${"01".repeat(32)}` as Hex;
    const childHash = `0x${"02".repeat(32)}` as Hex;
    const registry = fakeRegistry({
      [rootHash]: { delegator: A, parentHash: childHash },
      [childHash]: { delegator: B, parentHash: rootHash },
    });

    const result = await buildLineage(registry, REGISTRY, childHash, 4);
    expect(result.truncated).toBe(true);
  });

  it("accepts a caller-supplied root sentinel for a registry that uses its own", async () => {
    const customRoot = `0x${"ff".repeat(32)}` as Hex;
    const d = delegation(customRoot, 1n);
    const h = hashDelegation(d);
    const registry = fakeRegistry({ [h]: { delegator: A, parentHash: customRoot } });

    const result = await buildLineage(registry, REGISTRY, h, 8, customRoot);
    expect(result.chain).toHaveLength(1);
    expect(result.truncated).toBe(false);
    expect(registry.calls).toEqual([h]);
  });
});
