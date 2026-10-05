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

import { COMMIT_STATES, COMMIT_STATE_RANK, TOKENS, type CommitState } from "./addresses.js";
import type { Address } from "viem";

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

/**
 * A finality ladder, keyed by price.
 *
 * The key was `maxUsdc`, a float, and that was the problem: the seller prices in
 * base units of whichever token the authority cap is denominated in, and on Monad
 * testnet that is WMON at eighteen decimals. Handing `policyFor` a base-unit
 * amount as if it were USDC put 0.8 WMON into the 0.01-USDC band and released a
 * resource at `Proposed`, and handed 8e7 USDC base units into the 1-USDC band and
 * released at `Voted`. Neither answer was the one the bands describe.
 *
 * `maxAmount` is a bigint in the base units of `token` now, so a comparison cannot
 * silently cross decimals. `mayRelease` is the function that matters; this is only
 * how a policy is chosen.
 */
export type ReleasePolicy = { maxAmount: bigint; token: Address | null; releaseAt: CommitState };

/**
 * Conservative default, in USDC base units.
 *
 * Kept for callers that genuinely settle in USDC. It is not the policy this
 * project's seller uses: the seller's tiers carry `releaseAt` directly, because a
 * ladder keyed in one token is not a statement about a price in another.
 */
export const DEFAULT_RELEASE_POLICY: readonly ReleasePolicy[] = [
  { maxAmount: 10_000n, token: TOKENS.usdc.testnet as Address, releaseAt: "Proposed" },
  { maxAmount: 1_000_000n, token: TOKENS.usdc.testnet as Address, releaseAt: "Voted" },
  { maxAmount: 2n ** 63n - 1n, token: TOKENS.usdc.testnet as Address, releaseAt: "Finalized" },
];

/**
 * The ladder entry for an amount, refusing to compare across tokens.
 *
 * `token: null` on an entry means "any token", which is only safe for a catch-all
 * at the top of the ladder. An entry that names a token will not be matched by an
 * amount in a different one, because a 6-decimal and an 18-decimal base unit are
 * not the same size and picking the first match would be a coin flip.
 */
export function policyFor(
  amount: bigint,
  token: Address,
  policy: readonly ReleasePolicy[] = DEFAULT_RELEASE_POLICY,
): ReleasePolicy {
  const matches = policy.filter((tier) => tier.token === null || tier.token.toLowerCase() === token.toLowerCase());
  for (const tier of matches) {
    if (amount <= tier.maxAmount) return tier;
  }
  const last = matches[matches.length - 1];
  if (last === undefined) throw new Error(`no release policy entry for ${token}`);
  return last;
}

export function mayRelease(current: CommitState | null, required: CommitState): boolean {
  if (current === null) return false;
  return COMMIT_STATE_RANK[current] >= COMMIT_STATE_RANK[required];
}
