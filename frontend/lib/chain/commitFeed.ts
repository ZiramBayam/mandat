'use client';

/**
 * The commit feed, as a React hook.
 *
 * ## Why this is not a raw WebSocket
 *
 * The frontend used to open its own `eth_subscribe` to `monadNewHeads`. That
 * version had no fail-closed behaviour: when the socket dropped it left whatever
 * the last state was on screen, which reads as "finalized". That is the exact
 * failure Three-Light exists to prevent, and the seller in
 * `@mandat/authority-header` treats unknown as withhold because of it.
 *
 * `@mandat/three-light`'s `CommitFeed` already owns that: on disconnect it clears
 * its state rather than freezing a stale value. Using it here means the explorer
 * and the seller agree on what an unknown state means.
 *
 * ## Why the head count is not React state
 *
 * Monad testnet produces a block every ~0.31 seconds, so this feed delivers
 * roughly 194 heads per minute. Calling `setState` per head would re-render React
 * about three times per second, permanently, on a page that also renders WebGL.
 *
 * So the counters live in a ref, are accumulated as the feed reports them, and are
 * published to React on a one-second tick. React re-renders only when the socket
 * connects or disconnects, or when `lastCommitState` genuinely changes. The
 * numbers are still live; they are just not a render per head.
 */

import { useEffect, useRef, useState } from 'react';
import { CommitFeed, type CommitState, type FeedStatus } from '@mandat/three-light';
import { MONAD_TESTNET } from '@mandat/protocol';
import { MONAD_TESTNET_CHAIN } from './viemChain';

/** How often the accumulated counters are pushed into React state. */
const PUBLISH_INTERVAL_MS = 1000;

/**
 * One feed for the whole app.
 *
 * Four scenes mounting four sockets would mean four subscriptions and four views
 * of the same feed, which is how two components end up disagreeing about what the
 * chain just said.
 */
let shared: CommitFeed | null = null;
function feed(): CommitFeed {
  shared ??= new CommitFeed(MONAD_TESTNET);
  return shared;
}

export type CommitFeedState = {
  connected: boolean;
  lastCommitState: CommitState | null;
  heads: number;
  finalFloor: number;
  /** Set once the first head arrives; before that there is nothing to show. */
  started: boolean;
};

const INITIAL: CommitFeedState = {
  connected: false,
  lastCommitState: null,
  heads: 0,
  finalFloor: 0,
  started: false,
};

export function useCommitFeed(): CommitFeedState {
  const [state, setState] = useState<CommitFeedState>(INITIAL);

  // The per-head tally. Mutated by the observer, drained by the interval, never
  // rendered directly.
  const pending = useRef({ heads: 0, finalFloor: 0, last: null as CommitState | null });

  useEffect(() => {
    const f = feed();

    // Register the observer BEFORE connecting. `Proposed` exists for a few
    // hundred milliseconds, and a subscriber attached after the socket opens can
    // miss it -- which is the first lamp of the demo.
    const unsubscribe = f.subscribe((head) => {
      pending.current.heads += 1;
      pending.current.last = head.commitState;
      const status: FeedStatus = f.status();
      pending.current.finalFloor = status.finalFloor;
    });

    f.connect();

    setState((prev) => (prev.connected ? prev : { ...prev, connected: f.connected }));

    const tick = setInterval(() => {
      const { heads, finalFloor, last } = pending.current;
      pending.current = { heads: 0, finalFloor: 0, last: null };

      setState((prev) => {
        const connected = f.connected;
        const next: CommitFeedState = {
          connected,
          lastCommitState: last ?? prev.lastCommitState,
          heads: heads > 0 ? prev.heads + heads : prev.heads,
          finalFloor: finalFloor > 0 ? finalFloor : prev.finalFloor,
          started: prev.started || heads > 0,
        };

        // Skip the render entirely when nothing observable changed. An interval
        // that fires every second should not cost a render every second.
        if (
          next.connected === prev.connected &&
          next.lastCommitState === prev.lastCommitState &&
          next.heads === prev.heads &&
          next.finalFloor === prev.finalFloor &&
          next.started === prev.started
        ) {
          return prev;
        }
        return next;
      });
    }, PUBLISH_INTERVAL_MS);

    return () => {
      clearInterval(tick);
      unsubscribe();
      // The socket is shared and intentionally outlives this component; it is not
      // disconnected here. Tearing it down on unmount would make a route change
      // drop the feed and lose the Proposed state for the next mount.
    };
  }, []);

  return state;
}

/**
 * Resolve one transaction's commit state from the feed's own index.
 *
 * Returns `null` when the feed never saw that block. Callers must render null as
 * *unknown*, never as success.
 */
export async function resolveTxCommitState(txHash: `0x${string}`): Promise<CommitState | null> {
  const f = feed();
  const { createPublicClient, http } = await import('viem');
  const client = createPublicClient({
    chain: MONAD_TESTNET_CHAIN,
    transport: http(MONAD_TESTNET_CHAIN.rpcUrls.default.http[0]),
  });
  return f.statusOf((hash) => client.getTransactionReceipt({ hash: hash as `0x${string}` }), txHash);
}

/** Direct access for the scene that needs the raw index. */
export function getSharedFeed(): CommitFeed {
  return feed();
}

export type { CommitState };