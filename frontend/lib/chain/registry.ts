'use client';

/**
 * Reading the authority graph, from Monad and nowhere else.
 *
 * working/constraints.md rule R6: this UI holds no state that is not read from
 * chain. There is no backend, no indexer, and no cache that could disagree with
 * the registry. Every number below comes from an `eth_call` against the deployed
 * `AuthorityRegistry`.
 *
 * What this layer deliberately does NOT do is decide whether a delegation is
 * good. It reports what the registry says and lets the scenes present it. An
 * explorer that filtered by its own opinion would be the thing we are building
 * against.
 */

import { useEffect, useState } from 'react';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { authorityRegistryAbi, buildLineage, type AuthorityMeta } from '@mandat/protocol';
import { MONAD_TESTNET_CHAIN } from './viemChain';

/**
 * One client for the whole app.
 *
 * Batched, because the public endpoint rate-limits `eth_call` to 15 requests per
 * second and four scenes reading independently would trip that immediately.
 */
const client = createPublicClient({
  chain: MONAD_TESTNET_CHAIN,
  transport: http(MONAD_TESTNET_CHAIN.rpcUrls.default.http[0], { batch: true }),
});

export type Async<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed'; error: string };

/**
 * Generic read hook.
 *
 * The three states are kept distinct on purpose. Collapsing "failed" into
 * "loading" is how an explorer ends up rendering a zero and reading it as a
 * fact about the chain rather than a failure to ask.
 */
function useRead<T>(key: string | undefined, read: () => Promise<T>, deps: readonly unknown[]): Async<T> {
  const [result, setResult] = useState<Async<T>>({ state: 'loading' });

  useEffect(() => {
    if (key === undefined) {
      setResult({ state: 'failed', error: 'no address configured' });
      return;
    }
    let cancelled = false;
    setResult({ state: 'loading' });
    void read().then(
      (value) => {
        if (!cancelled) setResult({ state: 'ready', value });
      },
      (error: unknown) => {
        if (cancelled) return;
        setResult({ state: 'failed', error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);

  return result;
}

export function useRegistryClient(): typeof client {
  return client;
}

export function useDelegationCount(registry: Address | undefined): Async<bigint> {
  return useRead(
    registry,
    () =>
      client.readContract({ address: registry as Address, abi: authorityRegistryAbi, functionName: 'delegationCount' }),
    [registry],
  );
}

/**
 * The delegation's own row.
 *
 * A row that reads as all zeroes is *absent*, not present-and-empty: the registry
 * has no `authorities` getter that can return undefined, so a missing key comes
 * back as a zeroed tuple. Treating that as a real row would put a fabricated
 * delegation in the graph.
 */
export type DelegationState = {
  exists: boolean;
  meta: AuthorityMeta | null;
  isRegistered: boolean;
  isLive: boolean;
};

export function useDelegationState(
  registry: Address | undefined,
  hash: Hex | undefined,
): Async<DelegationState> {
  return useRead<DelegationState>(
    registry && hash ? `${registry}:${hash}` : undefined,
    async () => {
      const meta = (await client.readContract({
        address: registry as Address,
        abi: authorityRegistryAbi,
        functionName: 'authorities',
        args: [hash as Hex],
      })) as AuthorityMeta;
      const exists = !/^0x0{40}$/i.test(meta.delegator);
      if (!exists) return { exists: false, meta: null, isRegistered: false, isLive: false };
      const [isRegistered, isLive] = await Promise.all([
        client.readContract({ address: registry as Address, abi: authorityRegistryAbi, functionName: 'isRegistered', args: [hash as Hex] }),
        client.readContract({ address: registry as Address, abi: authorityRegistryAbi, functionName: 'isLive', args: [hash as Hex] }),
      ]);
      return { exists: true, meta, isRegistered, isLive };
    },
    [registry, hash],
  );
}

/**
 * Who authorised this, through whom. Root first, leaf last.
 *
 * `truncated` is surfaced alongside the chain and never folded into it. A walk
 * that stopped at `maxDepth` looks exactly like a short authority path, and a
 * reader would report "human, then agent" when there may be more hops above.
 */
export type Lineage = { chain: AuthorityMeta[]; truncated: boolean };

export function useLineage(registry: Address | undefined, hash: Hex | undefined): Async<Lineage> {
  return useRead<Lineage>(
    registry && hash ? `${registry}:${hash}` : undefined,
    () => buildLineage(client, registry as Address, hash as Hex) as Promise<Lineage>,
    [registry, hash],
  );
}

export function useManifestCid(registry: Address | undefined, manifest: Hex | undefined): Async<string> {
  return useRead(
    registry && manifest ? `${registry}:${manifest}` : undefined,
    () =>
      client.readContract({
        address: registry as Address,
        abi: authorityRegistryAbi,
        functionName: 'manifestCid',
        args: [manifest as Hex],
      }),
    [registry, manifest],
  );
}

export function useManifestLive(registry: Address | undefined, manifest: Hex | undefined): Async<boolean> {
  return useRead(
    registry && manifest ? `${registry}:${manifest}` : undefined,
    () =>
      client.readContract({
        address: registry as Address,
        abi: authorityRegistryAbi,
        functionName: 'liveManifests',
        args: [manifest as Hex],
      }),
    [registry, manifest],
  );
}

export function useAgentId(registry: Address | undefined, agent: Address | undefined): Async<bigint> {
  return useRead(
    registry && agent ? `${registry}:${agent}` : undefined,
    () =>
      client.readContract({
        address: registry as Address,
        abi: authorityRegistryAbi,
        functionName: 'agentIdOf',
        args: [agent as Address],
      }),
    [registry, agent],
  );
}

/**
 * Read a transaction's outcome straight from chain.
 *
 * Scenes need this to show that the over-cap redemption *was mined and reverted*
 * rather than refused by our middleware. That distinction is the entire claim of
 * the enforcement scene, so it is read from the receipt and not inferred.
 */
export async function readTxOutcome(hash: Hex): Promise<{ status: 'success' | 'reverted'; block: string; gasUsed: bigint }> {
  const receipt = await client.getTransactionReceipt({ hash });
  return {
    status: receipt.status === 'success' ? 'success' : 'reverted',
    block: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed,
  };
}

export async function readTokenBalance(token: Address, holder: Address): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }],
    functionName: 'balanceOf',
    args: [holder],
  });
}

export { client as publicClient };