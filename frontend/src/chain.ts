/**
 * The explorer reads Monad and nothing else.
 *
 * Rule R6 in working/constraints.md: no state in this UI that is not read from
 * chain. The AuthorityRegistry is the source of truth for attribution, not an
 * indexer we run. If a page would need a backend to render, the design is wrong.
 */

import { useEffect, useMemo, useState } from "react";
import { authorityRegistryAbi, MONAD_TESTNET } from "@mandat/protocol";
import { createPublicClient, http, type Address, type Hex } from "viem";

export type Lineage = {
  delegator: Address;
  delegate: Address;
  agentId: bigint;
  parentHash: Hex;
  manifestHash: Hex;
  createdAt: bigint;
  revokedAt: bigint;
};

export function useRegistry(registry?: Address) {
  const client = useMemo(() => createPublicClient({ transport: http(MONAD_TESTNET.rpc) }), []);
  const [count, setCount] = useState<bigint | null>(null);

  useEffect(() => {
    if (registry === undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const n = await client.readContract({
          address: registry,
          abi: authorityRegistryAbi,
          functionName: "delegationCount",
        });
        if (!cancelled) setCount(n);
      } catch {
        if (!cancelled) setCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, registry]);

  return { count };
}

/**
 * Commit state for the lamps. The browser subscribes to the Monad feed itself
 * rather than asking our server, so the UI has no backend dependency and the
 * feed cannot be tampered with by anything we run. See working/architecture.md 7.
 */
export function useCommitFeed() {
  const [state, setState] = useState<{ connected: boolean; last: string | null }>({
    connected: false,
    last: null,
  });

  useEffect(() => {
    const socket = new WebSocket(MONAD_TESTNET.wss);
    socket.addEventListener("open", () => {
      setState((prev) => ({ ...prev, connected: true }));
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["monadNewHeads"] }));
    });
    socket.addEventListener("message", (event) => {
      const parsed = JSON.parse(String(event.data)) as { params?: { result?: { commitState?: string } } };
      const commitState = parsed.params?.result?.commitState;
      if (typeof commitState === "string") setState((prev) => ({ ...prev, last: commitState }));
    });
    socket.addEventListener("close", () => setState((prev) => ({ ...prev, connected: false })));
    return () => socket.close();
  }, []);

  return state;
}
