import { MONAD_TESTNET } from "@mandat/protocol";
import { useCommitFeed, useRegistry } from "./chain.js";

/**
 * Four scenes, matching working/prd.md 6. Nothing here renders a value that is
 * not read from chain or from a live Monad feed.
 */
export function App() {
  const feed = useCommitFeed();
  const registry = import.meta.env["VITE_AUTHORITY_REGISTRY"] as `0x${string}` | undefined;
  const { count } = useRegistry(registry);

  return (
    <main>
      <h1>Mandat</h1>
      <p>
        User-owned authority for agents and skills. Monad testnet ({MONAD_TESTNET.chainId}).
      </p>

      <section>
        <h2>Authority graph</h2>
        <p>registered delegations: {count === null ? "registry not deployed yet" : count.toString()}</p>
        <p>
          registry: <code>{registry ?? "unset — see working/plan.md G2"}</code>
        </p>
      </section>

      <section>
        <h2>Commit feed</h2>
        <p>
          socket {feed.connected ? "connected" : "disconnected"}
          {feed.last === null ? "" : `, last head ${feed.last}`}
        </p>
        <p>When the socket is down, resources are withheld. Never released on a guess.</p>
      </section>
    </main>
  );
}
