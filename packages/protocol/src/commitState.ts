/**
 * Commit-state tracking for Three-Light.
 *
 * Hard constraints, all verified on a live feed on 26 Sep 2026
 * (working/constraints.md 5):
 *
 *  1. `commitState` appears ONLY on the `monadNewHeads` WSS subscription.
 *     `eth_getBlockByNumber` never returns it. There is no polling fallback.
 *  2. The head is header-only: no `transactions` array. So a payment tx cannot
 *     be matched to a block from the feed. We must resolve blockHash first.
 *  3. There are FOUR states, not three: Proposed, Voted, Finalized, Verified.
 */

import { COMMIT_STATES, COMMIT_STATE_RANK, type CommitState } from "./addresses.js";

export type MonadHead = {
  blockId: string;
  commitState: CommitState;
  hash: string;
  number: string;
  parentHash: string;
  timestamp: string;
};

export function parseHead(raw: unknown): MonadHead | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const commitState = r["commitState"];
  const hash = r["hash"];
  const blockId = r["blockId"];
  if (typeof commitState !== "string" || !COMMIT_STATES.includes(commitState as CommitState)) return null;
  if (typeof hash !== "string" || typeof blockId !== "string") return null;
  return {
    commitState: commitState as CommitState,
    hash,
    blockId,
    number: typeof r["number"] === "string" ? r["number"] : "0x0",
    parentHash: typeof r["parentHash"] === "string" ? r["parentHash"] : "0x",
    timestamp: typeof r["timestamp"] === "string" ? r["timestamp"] : "0x0",
  };
}

export type CommitIndexSnapshot = {
  /** blockHash -> commitState */
  byBlockHash: Map<string, CommitState>;
  /** blockId -> commitState */
  byBlockId: Map<string, CommitState>;
  /** Highest block number seen at Finalized or better. */
  finalFloor: number;
  headCount: number;
};

export class CommitIndex {
  readonly #byBlockHash = new Map<string, CommitState>();
  readonly #byBlockId = new Map<string, CommitState>();
  #finalFloor = 0;
  #headCount = 0;
  #connected = false;

  get connected(): boolean {
    return this.#connected;
  }

  setConnected(value: boolean): void {
    this.#connected = value;
  }

  ingest(raw: unknown): MonadHead | null {
    const head = parseHead(raw);
    if (head === null) return null;
    this.#headCount += 1;
    this.#byBlockHash.set(head.hash, head.commitState);
    this.#byBlockId.set(head.blockId, head.commitState);
    const n = Number.parseInt(head.number, 16);
    if (Number.isFinite(n) && COMMIT_STATE_RANK[head.commitState] >= COMMIT_STATE_RANK.Finalized) {
      if (n > this.#finalFloor) this.#finalFloor = n;
    }
    return head;
  }

  statusOfBlockHash(blockHash: string): CommitState | undefined {
    return this.#byBlockHash.get(blockHash);
  }

  snapshot(): CommitIndexSnapshot {
    return {
      byBlockHash: new Map(this.#byBlockHash),
      byBlockId: new Map(this.#byBlockId),
      finalFloor: this.#finalFloor,
      headCount: this.#headCount,
    };
  }

  /**
   * Fail-closed resolution.
   *
   * Returns `null` when we cannot prove the state, and callers MUST treat that
   * as "withhold". A dropped socket must never turn into a released resource.
   *
   * The only inference we allow: if we have seen a Finalized head at a block
   * number at or beyond the target, an unseen block below it cannot still be
   * unfinalized, so it is Finalized.
   */
  resolve(blockHash: string | undefined, blockNumber: number | undefined): CommitState | null {
    if (blockHash !== undefined) {
      const known = this.#byBlockHash.get(blockHash);
      if (known !== undefined) return known;
    }
    if (blockNumber !== undefined && blockNumber <= this.#finalFloor) return "Finalized";
    return null;
  }
}

export type ReleasePolicy = { maxUsdc: number; releaseAt: CommitState };

/** Conservative default. Prices are USDC with 6 decimals. */
export const DEFAULT_RELEASE_POLICY: readonly ReleasePolicy[] = [
  { maxUsdc: 0.01, releaseAt: "Proposed" },
  { maxUsdc: 1, releaseAt: "Voted" },
  { maxUsdc: Number.POSITIVE_INFINITY, releaseAt: "Finalized" },
];

export function policyFor(priceUsdc: number, policy: readonly ReleasePolicy[] = DEFAULT_RELEASE_POLICY): ReleasePolicy {
  for (const tier of policy) {
    if (priceUsdc <= tier.maxUsdc) return tier;
  }
  const last = policy[policy.length - 1];
  if (last === undefined) throw new Error("release policy is empty");
  return last;
}

export function mayRelease(current: CommitState | null, required: CommitState): boolean {
  if (current === null) return false;
  return COMMIT_STATE_RANK[current] >= COMMIT_STATE_RANK[required];
}
