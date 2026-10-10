/**
 * Addresses and transaction hashes, read from chain rather than asserted here.
 *
 * The hashes are constants because a transaction hash is its own evidence -- there
 * is nothing to derive. Everything *about* those transactions is fetched at
 * runtime by the scenes: status, block, gas, balance. A scene that printed "reverted"
 * from a hardcoded string would be reporting our own expectation rather than the
 * chain, and that distinction is the entire claim of scene two.
 *
 * The contract addresses come from `contracts/deployments.md`, which records the
 * blocks they were deployed at.
 */

export const REGISTRY = '0xb51807EC9C8090c155E80B085ebdD999CCf68D30' as const;
export const ROOT_DELEGATOR = '0xDf9E68Bee379A298709aeb94072d1b1b9A333921' as const;
export const AGENT = '0x2D5d77f3745df1CE7A14e91A087FE44dbA8775A2' as const;
export const SUBAGENT = '0xeDaeDED39518ac8979F6E6df32d0D0dB68EaED45' as const;
export const WMON = '0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541' as const;

/** Delegation hash of the live root-to-agent authority. */
export const LIVE_DELEGATION =
  '0x7599f34b7c832e8c70027b9f0745091ae8a873d7608b1d24d7e66051f98ee0a2' as const;

export const MANIFEST = '0xeb4c4e0291f09b5342f66d21de289c8c27b8923d9932e7a00fcc88a921831fc6' as const;

/** Scene 2: the pair. One mined and succeeded, one mined and reverted. */
export const TX_WITHIN_CAP =
  '0x8c3f365859ab4a78de9b4bd26b9cbdb0cf6d37f01412022a5df369d41f6c3b00' as const;
export const TX_OVER_CAP =
  '0x0a2c43451a899cefe9855998e5f6e6dac089b8a8b921b3832ed93b0dcced0e15' as const;

/** Scene 3: the agent's own purchase, and the premium attempt it declined. */
export const TX_AGENT_CHEAP =
  '0xf6ff1dfd267d81708f787908b2f74fd1d60e00e29ec99ff5ab08196c4854b6a6' as const;
export const TX_AGENT_PREMIUM =
  '0x04621edfb228a0185b071bc5bc9d6b1e729d0a716198208241c16b91b7e87bb9' as const;

/** Scene 1: the spend cap, in base units, and its token. */
export const CAP_BASE_UNITS = 500_000_000_000_000_000n; // 0.5 WMON
export const PERIOD_SECONDS = 86_400;

export const EXPLORER_TX = (hash: string) => `https://testnet.monadvision.com/tx/${hash}`;
export const EXPLORER_ADDRESS = (hash: string) => `https://testnet.monadvision.com/address/${hash}`;