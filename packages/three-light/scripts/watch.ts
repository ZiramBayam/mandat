#!/usr/bin/env node
/**
 * Follow a real transaction through Monad's finality, on a live socket.
 *
 * This is the Three-Light demo in one process: it opens the `monadNewHeads`
 * subscription, waits for heads, and then reports how a specific transaction's
 * commit state advanced from Proposed to Verified.
 *
 * Two properties make it more than a status display:
 *
 *  - The socket is opened *before* the transaction is watched, because
 *    `commitState` exists only on this feed and nowhere else. A late subscriber
 *    has already missed the Proposed and Voted heads, so it can never show the
 *    first two lamps. Polling `eth_getBlockByNumber` does not help: the payload
 *    has no commitState. See working/constraints.md 5.
 *
 *  - Nothing is inferred. A state the feed never showed is reported as unknown,
 *    and unknown means withheld. If the socket drops, the lamps go out rather than
 *    freezing on the last known value, because a frozen "Finalized" is exactly the
 *    failure this package exists to prevent.
 *
 * Usage:
 *   tsx scripts/watch.ts <txHash> [--settle-usdc 0.01] [--timeout 300]
 *
 * With no transaction it reports the feed itself, which is the cheapest way to
 * confirm that a chain still publishes commitState.
 */

import { createPublicClient, http, type Address, type Hex } from "viem";
import {
  COMMIT_STATES,
  COMMIT_STATE_RANK,
  MONAD_TESTNET,
  mayRelease,
  policyFor,
  type CommitState,
} from "@mandat/protocol";
import { CommitFeed } from "../src/index.js";

const USDC_TESTNET = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as Address;
const LAMP_ORDER: readonly CommitState[] = ["Proposed", "Voted", "Finalized", "Verified"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

// `pnpm run watch -- 0xabc` forwards a bare "--" to the script, so positional
// arguments are collected from anywhere in argv rather than read from index 2.
const positionals = process.argv.slice(2).filter((a) => a !== "--" && !a.startsWith("--"));
const txHash = positionals[0]?.startsWith("0x") ? (positionals[0] as Hex) : undefined;
const settleUsdc = Number(arg("settle-usdc") ?? "0.01");
const timeoutSeconds = Number(arg("timeout") ?? "300");
const policy = policyFor(settleUsdc);

/**
 * Lamps as a fixed row, so a state that has not been seen is visibly empty rather
 * than absent. The demo needs the difference between "not yet" and "not this time".
 */
function renderLamps(seen: ReadonlySet<CommitState>, current: CommitState | null): string {
  return LAMP_ORDER.map((state) => {
    if (!seen.has(state)) return `${state.padEnd(9)} ○`;
    const isCurrent = current === state;
    return `${state.padEnd(9)} ${isCurrent ? "●" : "✓"}`;
  }).join("   ");
}

async function main(): Promise<void> {
  const feed = new CommitFeed(MONAD_TESTNET);
  const client = createPublicClient({ transport: http(MONAD_TESTNET.rpc) });

  const seen = new Set<CommitState>();
  let current: CommitState | null = null;
  let lastBlock = 0;

  // Painted on change, not on every head. Monad emits heads far faster than a
  // person reads, and a per-head repaint turns a status line into thousands of
  // lines in a log file, which is the opposite of what a recording needs.
  let lastPainted: CommitState | null = null;
  const paint = (): void => {
    if (current === lastPainted) return;
    lastPainted = current;
    process.stdout.write(
      `  head ${String(lastBlock).padStart(9)}  ${(current ?? "?").padEnd(9)}  ${renderLamps(seen, current)}\n`,
    );
  };

  const unsubscribe = feed.subscribe((head) => {
    lastBlock = head.blockNumber;
    current = head.commitState;
    seen.add(head.commitState);
    paint();
  });

  // Opened after the observer is registered, so no head can arrive with nobody
  // watching. The comment above is the reason the ordering matters: Proposed is
  // the only state that exists for a few hundred ms, and a missed one cannot be
  // recovered by polling afterwards.
  feed.connect();

  // The subscription's own status, so a drop is visible while it happens.
  const watchConnection = setInterval(() => {
    if (!feed.connected) {
      // Fail closed: the lamps are cleared rather than left showing the last
      // state, because that state is no longer being updated.
      seen.clear();
      current = null;
      process.stdout.write("\nsocket dropped; lamps cleared and withholding until it returns\n");
    }
  }, 1000);

  process.stdout.write(
    `feed: ${MONAD_TESTNET.wss}\n` +
      `subscription: eth_subscribe ["monadNewHeads"]\n` +
      (txHash === undefined
        ? `reporting the feed; pass a tx hash to follow a payment\n\n`
        : `following ${txHash}\n` +
            // The policy is denominated in a notional price, not in the token that
            // moved. On testnet the payment settles in WMON because no USDC is
            // available, but the release threshold is the same regardless of which
            // token carried the value.
            `price tier ${settleUsdc} (priced as USDC; the token paid may be WMON), ` +
            `releasable at ${policy.releaseAt}\n\n`),
  );
  paint();

  const deadline = Date.now() + timeoutSeconds * 1000;
  let released = false;

  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));

      if (!feed.connected) continue;
      if (txHash === undefined) continue;

      const state = await feed.statusOf(
        (hash) => client.getTransactionReceipt({ hash }),
        txHash,
      );
      if (state === null) continue;

      if (!seen.has(state)) {
        seen.add(state);
        current = state;
        paint();
        process.stdout.write(
          `\n  ${txHash} reached ${state} at head ${lastBlock}` +
            (mayRelease(state, policy.releaseAt) ? " -- releasable" : ` -- still withholding, needs ${policy.releaseAt}`),
        );
      }

      if (!released && mayRelease(state, policy.releaseAt)) {
        released = true;
        process.stdout.write(
          `\nRELEASED at ${state}. The policy asked for ${policy.releaseAt}; ` +
            "the resource may be handed over.\n",
        );
      }
    }
  } finally {
    clearInterval(watchConnection);
    unsubscribe();
    feed.disconnect();
  }

  process.stdout.write(`\n\nheads seen: ${feed.status().heads}, finality floor: ${feed.status().finalFloor}\n`);
  process.stdout.write(
    `states observed: ${[...seen].sort((a, b) => COMMIT_STATE_RANK[a] - COMMIT_STATE_RANK[b]).join(" -> ") || "none"}\n`,
  );
  process.stdout.write(
    `Monad has ${COMMIT_STATES.length} commit states, not three. Verified is real and is the last lamp.\n`,
  );
  if (!released && txHash !== undefined) {
    process.stdout.write(`\nnever reached ${policy.releaseAt} within ${timeoutSeconds}s; nothing was released\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
