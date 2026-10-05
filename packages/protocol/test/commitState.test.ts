import { describe, expect, it } from "vitest";
import { TOKENS } from "../src/addresses.js";
import { CommitIndex, DEFAULT_RELEASE_POLICY, mayRelease, parseHead, policyFor } from "../src/commitState.js";

/** Shape captured from a live `monadNewHeads` subscription, 26 Sep 2026. */
function head(commitState: string, hash: string, blockId: string, blockNumber: number) {
  return {
    blockId,
    commitState,
    hash,
    number: `0x${blockNumber.toString(16)}`,
    parentHash: "0x",
    timestamp: "0x0",
  };
}

describe("parseHead", () => {
  it("accepts a real head payload", () => {
    const parsed = parseHead(head("Proposed", "0xabc", "0xdef", 100));
    expect(parsed?.commitState).toBe("Proposed");
    expect(parsed?.hash).toBe("0xabc");
  });

  it("rejects a plain eth_subscribe newHeads payload that lacks commitState", () => {
    expect(parseHead({ hash: "0xabc", number: "0x64", parentHash: "0x" })).toBeNull();
  });

  it("rejects an unknown commit state", () => {
    expect(parseHead(head("Speculative", "0xabc", "0xdef", 100))).toBeNull();
  });
});

describe("CommitIndex", () => {
  it("tracks a block through Proposed, Voted and Finalized", () => {
    const idx = new CommitIndex();
    const h = head("Proposed", "0xb1", "0xid1", 100);
    idx.ingest(h);
    expect(idx.statusOfBlockHash("0xb1")).toBe("Proposed");
    idx.ingest({ ...h, commitState: "Voted" });
    expect(idx.statusOfBlockHash("0xb1")).toBe("Voted");
    idx.ingest({ ...h, commitState: "Finalized" });
    expect(idx.statusOfBlockHash("0xb1")).toBe("Finalized");
  });

  it("records Verified as a fourth state", () => {
    const idx = new CommitIndex();
    idx.ingest(head("Verified", "0xb1", "0xid1", 100));
    expect(idx.statusOfBlockHash("0xb1")).toBe("Verified");
  });

  it("returns null rather than guessing, so callers fail closed", () => {
    const idx = new CommitIndex();
    expect(idx.resolve("0xunknown", undefined)).toBeNull();
  });

  it("infers Finalized only below the observed Finalized floor", () => {
    const idx = new CommitIndex();
    idx.ingest(head("Finalized", "0xb200", "0xid200", 200));
    expect(idx.resolve(undefined, 150)).toBe("Finalized");
    expect(idx.resolve(undefined, 250)).toBeNull();
  });
});

describe("release policy", () => {
  it("releases cheap resources at Proposed and expensive at Finalized", () => {
    expect(policyFor(5_000n, TOKENS.usdc.testnet).releaseAt).toBe("Proposed");
    expect(policyFor(500_000n, TOKENS.usdc.testnet).releaseAt).toBe("Voted");
    expect(policyFor(80_000_000n, TOKENS.usdc.testnet).releaseAt).toBe("Finalized");
  });

  it("refuses to read an 18-decimal amount against a 6-decimal ladder", () => {
    // The bug this type change prevents: 0.8 WMON is 8e17 base units, which is
    // larger than every band in a USDC ladder except the top one, so the seller
    // released an expensive resource at Finalized having meant to release a cheap
    // one at Voted. There is no correct answer here, only a refusal.
    expect(() => policyFor(800_000_000_000_000_000n, TOKENS.wrappedMon.testnet)).toThrow(/no release policy entry/);
  });

  it("never releases when the state is unknown", () => {
    expect(mayRelease(null, "Proposed")).toBe(false);
  });

  it("respects the minimum required state", () => {
    expect(mayRelease("Proposed", "Proposed")).toBe(true);
    expect(mayRelease("Proposed", "Finalized")).toBe(false);
    expect(mayRelease("Verified", "Finalized")).toBe(true);
  });

  it("has a policy that terminates at the most expensive tier", () => {
    const last = DEFAULT_RELEASE_POLICY[DEFAULT_RELEASE_POLICY.length - 1];
    expect(last?.releaseAt).toBe("Finalized");
  });
});
