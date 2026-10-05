/**
 * Three-Light: release a resource only once the payment block has reached the
 * commit state the price tier requires.
 *
 * Why this can only exist on Monad: `commitState` is published on the
 * `monadNewHeads` subscription and nowhere else. `eth_getBlockByNumber` does
 * not carry it, and a receipt exists before execution is final. So there is no
 * polling equivalent on another chain. See working/constraints.md 5.
 *
 * This package owns the socket lifecycle. It must be connected before a payment
 * is accepted, and every failure path withholds rather than releases.
 */

import { CommitIndex, MONAD_TESTNET, type CommitState, type MonadChain } from "@mandat/protocol";

export { CommitIndex, mayRelease, policyFor, DEFAULT_RELEASE_POLICY } from "@mandat/protocol";
export type { CommitState } from "@mandat/protocol";

export type FeedStatus = {
  connected: boolean;
  heads: number;
  finalFloor: number;
  lastCommitState: CommitState | null;
};

/** One head off the feed, or null for a keepalive that carried no block. */
export type Head = { commitState: CommitState; blockNumber: number; blockHash: string };

export class CommitFeed {
  readonly #index = new CommitIndex();
  #socket: WebSocket | null = null;
  #lastState: CommitState | null = null;
  #onStatus: (() => void) | null = null;
  #onHead: ((head: Head) => void) | null = null;

  constructor(private readonly chain: MonadChain = MONAD_TESTNET) {}

  /**
   * `eth_subscribe` with the literal "monadNewHeads". The plain "newHeads"
   * subscription also connects, but its payload has no commitState, so using it
   * would silently produce a feed that never resolves anything.
   */
  connect(onStatus?: () => void): void {
    if (this.#socket !== null) return;
    this.#onStatus = onStatus ?? null;
    const socket = new WebSocket(this.chain.wss);
    this.#socket = socket;

    socket.addEventListener("open", () => {
      this.#index.setConnected(true);
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["monadNewHeads"] }));
      this.#onStatus?.();
    });

    socket.addEventListener("message", (event) => {
      const parsed = JSON.parse(String(event.data)) as { params?: { result?: unknown } };
      if (parsed.params?.result === undefined) return;
      const head = this.#index.ingest(parsed.params.result);
      if (head !== null) {
        this.#lastState = head.commitState;
        this.#onHead?.({
          commitState: head.commitState,
          // The payload carries `number` and `hash` as hex strings; parse the
          // number once here so consumers do not each re-derive it.
          blockNumber: Number.parseInt(head.number, 16),
          blockHash: head.hash,
        });
        this.#onStatus?.();
      }
    });

    // Fail-closed. A dropped socket must look like "unknown", never like
    // "finalized", or a withheld resource would get released.
    socket.addEventListener("close", () => {
      this.#index.setConnected(false);
      this.#socket = null;
      this.#onStatus?.();
    });
    socket.addEventListener("error", () => {
      this.#index.setConnected(false);
      this.#onStatus?.();
    });
  }

  /**
   * Observe every head as it arrives.
   *
   * Exposed so a consumer can feed a CommitIndex of its own rather than reading
   * this class's internals. The seller used to open a second socket instead, which
   * meant two views of commitState and a release decision that could depend on
   * either.
   *
   * Returns an unsubscribe function, because the socket outlives most callers.
   */
  subscribe(onHead: (head: Head) => void): () => void {
    this.#onHead = onHead;
    return () => {
      if (this.#onHead === onHead) this.#onHead = null;
    };
  }

  disconnect(): void {
    this.#socket?.close();
    this.#socket = null;
    this.#index.setConnected(false);
  }

  get connected(): boolean {
    return this.#index.connected;
  }

  status(): FeedStatus {
    return {
      connected: this.#index.connected,
      heads: this.#index.snapshot().headCount,
      finalFloor: this.#index.snapshot().finalFloor,
      lastCommitState: this.#lastState,
    };
  }

  /**
   * Resolve a transaction's commit state. Returns null when unknown; callers
   * must treat null as "withhold".
   */
  async statusOf(
    getReceipt: (hash: string) => Promise<{ blockHash?: string | undefined; blockNumber: bigint }>,
    txHash: string,
  ): Promise<CommitState | null> {
    const receipt = await getReceipt(txHash);
    return this.#index.resolve(receipt.blockHash ?? undefined, Number(receipt.blockNumber));
  }
}
