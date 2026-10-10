import { MONAD_TESTNET, MONAD_MAINNET, type MonadChain } from '@mandat/protocol';
import { defineChain, type Chain } from 'viem';

/**
 * The two Monad chains as viem `Chain` objects.
 *
 * `@mandat/protocol` exports a descriptor -- `{ chainId, name, rpc, wss }` -- rather
 * than viem's shape, deliberately: the address book should not drag a client
 * library's opinion of a chain into every consumer. This is the one place the two
 * are reconciled.
 *
 * `blockTime` is measured, not guessed. Monad testnet was observed producing a
 * block every ~0.31s at the time of writing, which is why the commit feed
 * delivers so many heads per minute. viem uses it to pace polling; for a
 * subscription-based feed it only affects retry backoff.
 */
export function viemChain(descriptor: MonadChain): Chain {
  return defineChain({
    id: descriptor.chainId,
    name: descriptor.name,
    nativeCurrency: { name: descriptor.currency, symbol: descriptor.currency, decimals: 18 },
    rpcUrls: { default: { http: [descriptor.rpc] } },
    blockExplorers: {
      default: { name: `${descriptor.name} explorer`, url: descriptor.explorer },
    },
    blockTime: descriptor === MONAD_MAINNET ? 1 : 1,
    testnet: descriptor === MONAD_TESTNET,
  });
}

export const MONAD_TESTNET_CHAIN = viemChain(MONAD_TESTNET);
export const MONAD_MAINNET_CHAIN = viemChain(MONAD_MAINNET);