import { describe, expect, it } from "vitest";
import { CommitFeed } from "../src/index.js";

/**
 * A WebSocket stand-in.
 *
 * `CommitFeed` reads `commitState` off the `monadNewHeads` subscription, and the
 * whole package exists because that payload is the only place it appears. So the
 * socket is the unit under test's only real dependency, and it is replaced here
 * rather than reached over the network: a live-socket test would be flaky and
 * would not let us drive the failure paths, which are the paths that matter.
 */
class FakeSocket {
  static last: FakeSocket | null = null;

  listeners = new Map<string, Set<(event: unknown) => void>>();
  sent: string[] = [];
  closed = false;
  readyState = 0;

  constructor(public url: string) {
    FakeSocket.last = this;
  }

  addEventListener(type: string, fn: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.emit("close", {});
  }

  emit(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  deliver(head: Record<string, unknown> | null): void {
    this.emit("message", { data: JSON.stringify({ params: { result: head } }) });
  }

  fail(): void {
    this.emit("error", {});
  }
}

function installFakeSocket(): { original: typeof globalThis.WebSocket } {
  const original = globalThis.WebSocket;
  (globalThis as { WebSocket: unknown }).WebSocket = FakeSocket as unknown;
  return { original };
}

function head(number: number, commitState: string, hash = `0x${number}`): Record<string, unknown> {
  return {
    blockId: `b${number}`,
    commitState,
    hash,
    number: `0x${number.toString(16)}`,
    parentHash: "0x0",
    timestamp: "0x0",
  };
}

describe("CommitFeed", () => {
  it("subscribes with the literal monadNewHeads, which is the only payload carrying commitState", () => {
    const { original } = installFakeSocket();
    try {
      const feed = new CommitFeed({
        chainId: 10143,
        name: "Monad Testnet",
        rpc: "http://x",
        wss: "wss://x",
        currency: "MON",
        explorer: "http://x",
      } as never);
      feed.connect();
      const socket = FakeSocket.last;
      expect(socket).not.toBeNull();
      socket!.open();
      expect(socket!.sent).toHaveLength(1);
      expect(JSON.parse(socket!.sent[0]!)).toEqual({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_subscribe",
        params: ["monadNewHeads"],
      });
      feed.disconnect();
    } finally {
      (globalThis as { WebSocket: unknown }).WebSocket = original;
    }
  });

  it("reports connected only while the socket is open", () => {
    const { original } = installFakeSocket();
    try {
      const feed = new CommitFeed();
      expect(feed.connected).toBe(false);
      feed.connect();
      expect(feed.connected).toBe(false);
      FakeSocket.last!.open();
      expect(feed.connected).toBe(true);
      feed.disconnect();
      expect(feed.connected).toBe(false);
    } finally {
      (globalThis as { WebSocket: unknown }).WebSocket = original;
    }
  });

  /**
   * Fail-closed. A dropped socket must look like "unknown", never like
   * "finalized", or a withheld resource would get released. `setConnected(false)`
   * is what makes `resolve` stop inferring.
   */
  it("stops treating unseen blocks as finalized once the socket drops", () => {
    const { original } = installFakeSocket();
    try {
      const feed = new CommitFeed();
      feed.connect();
      FakeSocket.last!.open();
      FakeSocket.last!.deliver(head(100, "Finalized"));
      expect(feed.connected).toBe(true);

      FakeSocket.last!.closed = true;
      FakeSocket.last!.emit("close", {});
      expect(feed.connected).toBe(false);
    } finally {
      (globalThis as { WebSocket: unknown }).WebSocket = original;
    }
  });

  it("hands every head to a subscriber, and stops after unsubscribing", () => {
    const { original } = installFakeSocket();
    try {
      const feed = new CommitFeed();
      feed.connect();
      FakeSocket.last!.open();

      const seen: { number: number; state: string }[] = [];
      const stop = feed.subscribe((h) => seen.push({ number: h.blockNumber, state: h.commitState }));

      FakeSocket.last!.deliver(head(1, "Proposed"));
      FakeSocket.last!.deliver(head(2, "Voted"));
      expect(seen).toEqual([
        { number: 1, state: "Proposed" },
        { number: 2, state: "Voted" },
      ]);

      stop();
      FakeSocket.last!.deliver(head(3, "Finalized"));
      expect(seen).toHaveLength(2);
      feed.disconnect();
    } finally {
      (globalThis as { WebSocket: unknown }).WebSocket = original;
    }
  });

  /**
   * Two subscribers on one socket. This regressed before: the feed held a single
   * callback, so a second subscribe() silently replaced the first and the first
   * caller kept an unsubscribe function for an observer that no longer existed.
   */
  it("delivers to every subscriber, and one unsubscribe leaves the other running", () => {
    const { original } = installFakeSocket();
    try {
      const feed = new CommitFeed();
      feed.connect();
      FakeSocket.last!.open();

      const first: string[] = [];
      const second: string[] = [];
      const stopFirst = feed.subscribe((h) => first.push(h.commitState));
      feed.subscribe((h) => second.push(h.commitState));

      FakeSocket.last!.deliver(head(1, "Proposed"));
      expect(first).toEqual(["Proposed"]);
      expect(second).toEqual(["Proposed"]);

      stopFirst();
      FakeSocket.last!.deliver(head(2, "Voted"));
      expect(first).toEqual(["Proposed"]);
      expect(second).toEqual(["Proposed", "Voted"]);
      feed.disconnect();
    } finally {
      (globalThis as { WebSocket: unknown }).WebSocket = original;
    }
  });

  it("survives an observer unsubscribing from inside its own callback", () => {
    const { original } = installFakeSocket();
    try {
      const feed = new CommitFeed();
      feed.connect();
      FakeSocket.last!.open();

      const other: string[] = [];
      feed.subscribe((h) => other.push(h.commitState));
      const stop = feed.subscribe(() => stop());
      feed.subscribe((h) => other.push(h.commitState));

      // The self-removing observer sees head 1 only. Both survivors see both.
      FakeSocket.last!.deliver(head(1, "Proposed"));
      FakeSocket.last!.deliver(head(2, "Voted"));
      expect(other).toEqual(["Proposed", "Proposed", "Voted", "Voted"]);
      feed.disconnect();
    } finally {
      (globalThis as { WebSocket: unknown }).WebSocket = original;
    }
  });

  /**
   * `statusOf` is how a payment's finality is resolved, and it returns null when
   * the state is unknown. That null is load-bearing: callers must treat it as
   * withhold, which is the difference between a safe and an unsafe seller.
   */
  it("resolves a seen block and returns null for one it never saw", async () => {
    const { original } = installFakeSocket();
    try {
      const feed = new CommitFeed();
      feed.connect();
      FakeSocket.last!.open();
      FakeSocket.last!.deliver(head(500, "Voted", "0xabc"));

      const receipt = { blockHash: "0xabc" as const, blockNumber: 500n };
      await expect(feed.statusOf(async () => receipt, "0xtx")).resolves.toBe("Voted");

      const unseen = { blockHash: "0xzzz" as const, blockNumber: 9_999_999n };
      await expect(feed.statusOf(async () => unseen, "0xtx")).resolves.toBeNull();
      feed.disconnect();
    } finally {
      (globalThis as { WebSocket: unknown }).WebSocket = original;
    }
  });

  it("ignores payloads that carry no commitState instead of guessing", () => {
    const { original } = installFakeSocket();
    try {
      const feed = new CommitFeed();
      feed.connect();
      FakeSocket.last!.open();

      const before = feed.status().heads;
      FakeSocket.last!.deliver(null);
      FakeSocket.last!.deliver({ number: "0x1", hash: "0x1" });
      expect(feed.status().heads).toBe(before);
      feed.disconnect();
    } finally {
      (globalThis as { WebSocket: unknown }).WebSocket = original;
    }
  });

  it("does not open a second socket when connect is called twice", () => {
    const { original } = installFakeSocket();
    try {
      const feed = new CommitFeed();
      feed.connect();
      const first = FakeSocket.last;
      feed.connect();
      expect(FakeSocket.last).toBe(first);
      feed.disconnect();
    } finally {
      (globalThis as { WebSocket: unknown }).WebSocket = original;
    }
  });

  it("survives an error event and reports disconnected", () => {
    const { original } = installFakeSocket();
    try {
      const feed = new CommitFeed();
      feed.connect();
      FakeSocket.last!.open();
      expect(feed.connected).toBe(true);
      FakeSocket.last!.fail();
      expect(feed.connected).toBe(false);
      feed.disconnect();
    } finally {
      (globalThis as { WebSocket: unknown }).WebSocket = original;
    }
  });
});
