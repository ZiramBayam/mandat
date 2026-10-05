#!/usr/bin/env node
/**
 * G9: the revocation scene, as a CLI.
 *
 * Reads `AuthorityRegistry` and nothing else. No indexer, no subgraph, no cached
 * off-chain state, because the point of the scene is that the registry row is the
 * authority. A view that needed a second source of truth would prove nothing.
 *
 * Commands:
 *   explorer table                  every registered delegation and its live status
 *   explorer lineage <hash>         who authorised this, through whom
 *   explorer descendants <hash>     the direct children, which revocation kills
 *   explorer verify <hash>          isLive, plus the registry's own lineage view
 *   explorer revoke <hash>          withdraw, as the root delegator, through redeem
 *
 * Revocation is reachable only because the root delegator is a contract. See the
 * note in `g6.ts` `revokeByRootDelegator` for why the call has to be wrapped in a
 * redemption; the short version is that the registry requires
 * `msg.sender == meta.delegator`, and a contract delegator can only act through
 * its own entry points.
 */

import { readFileSync } from "node:fs";
import {
  MONAD_TESTNET,
  authorityRegistryAbi,
  buildLineage,
  buildRedeemTx,
  delegationTypedDataHash,
  erc20Transfer,
  hashDelegation,
  type Address,
  type Delegation,
  type Hex,
} from "@mandat/protocol";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { explainRevert } from "../src/protocol/revertReason.js";

const CHAIN = {
  id: MONAD_TESTNET.chainId,
  name: MONAD_TESTNET.name,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_TESTNET.rpc] } },
} as const;

const ROOT_AUTHORITY = `0x${"ff".repeat(32)}` as Hex;

/** Distinct from DELEGATION_SALT so the wrapper cannot collide with a spend. */
const REVOCATION_SALT = 9999n;

const REDEEM_GAS_LIMIT = 900_000n;

// Measured on testnet: an ERC-20 period transfer redeem used 515,563 gas, so the
// 900k cap carries real headroom. It is not free, though: at the observed 102 gwei
// the cap is 0.092 MON, which is why the agent account needs funding at all.

/**
 * Fees are estimated, then floored.
 *
 * A hardcoded 20 gwei was wrong, and not theoretically: Monad testnet's base fee
 * was observed at 100 gwei on 5 Oct 2026, and the node rejects a maxFeePerGas below
 * base fee with "Transaction fee too low". `g6.ts` still pins 20 gwei for the same
 * reason it did before, so it is now exposed to the same failure. The floor is set
 * from what the node suggests and then doubled, because a suggestion can be stale
 * by the time the transaction lands.
 *
 * The consequence for balances is worth stating: at 122 gwei, 900k gas of headroom
 * costs about 0.11 MON. An account holding 0.015 MON cannot send it, whatever the
 * transaction does. That is why `scene` tops the agent up first.
 */
async function fees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const block = await publicClient.getBlock();
  const estimate = await publicClient.estimateFeesPerGas();
  const base = block.baseFeePerGas ?? 0n;
  const suggested = estimate.maxFeePerGas ?? 0n;
  const maxFeePerGas = suggested > base * 2n ? suggested : base * 2n;
  return {
    maxFeePerGas,
    maxPriorityFeePerGas: estimate.maxPriorityFeePerGas ?? 1_000_000_000n,
  };
}

type Env = Record<string, string | undefined>;

function loadEnv(): Env {
  const out: Env = {};
  const url = new URL("../../../contracts/.env", import.meta.url);
  for (const line of readFileSync(url, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m?.[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv();

function need(name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} missing in contracts/.env`);
  return value;
}

function needKey(name: string): Hex {
  const value = need(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} is not a private key in contracts/.env`);
  return value as Hex;
}

function needAddress(name: string): Address {
  const value = need(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} is not an address`);
  return value as Address;
}

const registry = needAddress("AUTHORITY_REGISTRY");
const rootDelegator = needAddress("ROOT_DELEGATOR");
const manifestHash = need("MANIFEST_HASH") as Hex;
const recipient = privateKeyToAccount(needKey("SUBAGENT_PRIVATE_KEY")).address;
const user = privateKeyToAccount(needKey("USER_PRIVATE_KEY"));
const deployer = privateKeyToAccount(needKey("DEPLOYER_PRIVATE_KEY"));
const agent = privateKeyToAccount(needKey("AGENT_PRIVATE_KEY"));
const subAgent = privateKeyToAccount(needKey("SUBAGENT_PRIVATE_KEY"));

const publicClient = createPublicClient({ chain: CHAIN, transport: http(MONAD_TESTNET.rpc) }) as PublicClient;

// `pnpm run explorer -- table` forwards a bare "--", so positions are counted
// from the first argument that is not it.
const ARGS = process.argv.slice(2).filter((a) => a !== "--");

function arg(i: number): string | undefined {
  return ARGS[i];
}

function hexArg(value: string | undefined, label: string): Hex {
  if (value === undefined || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a 32-byte hash, got ${value ?? "nothing"}`);
  }
  return value as Hex;
}

type Meta = {
  delegator: Address;
  delegate: Address;
  agentId: bigint;
  parentHash: Hex;
  manifestHash: Hex;
  createdAt: bigint;
  revokedAt: bigint;
};

async function readMeta(hash: Hex): Promise<Meta | null> {
  const meta = (await publicClient.readContract({
    address: registry,
    abi: authorityRegistryAbi,
    functionName: "authorities",
    args: [hash],
  })) as Meta;
  return /^0x0{40}$/i.test(meta.delegator) ? null : meta;
}

async function isLive(hash: Hex): Promise<boolean> {
  return publicClient.readContract({
    address: registry,
    abi: authorityRegistryAbi,
    functionName: "isLive",
    args: [hash],
  });
}

async function descendants(hash: Hex): Promise<Hex[]> {
  return publicClient.readContract({
    address: registry,
    abi: authorityRegistryAbi,
    functionName: "descendantsOf",
    args: [hash],
  }) as Promise<Hex[]>;
}

const AUTHORITY_REGISTERED_EVENT = {
  type: "event",
  name: "AuthorityRegistered",
  inputs: [
    { indexed: true, name: "delegationHash", type: "bytes32" },
    { indexed: true, name: "delegator", type: "address" },
    { indexed: true, name: "delegate", type: "address" },
  ],
} as const;

/** The public testnet node caps an `eth_getLogs` range at 100 blocks. */
const LOG_RANGE_LIMIT = 100n;

/** Enough windows to cover a few days of Monad blocks, then it gives up loudly. */
const MAX_WINDOWS = 3_000;

/**
 * Every delegation this registry has ever recorded, from its own events.
 *
 * `descendantsOf` cannot be the entry point. `registerDelegation` only appends to
 * `_descendants` when the parent is a real delegation, and deliberately skips it
 * for `authority == ROOT_AUTHORITY`, so `descendantsOf(ROOT_AUTHORITY)` is
 * permanently empty. That is correct for the contract's purpose -- the array
 * exists to drive `_revokeSubtree`, and a root has nothing above it to drive --
 * but it means walking down from ROOT_AUTHORITY finds zero rows while
 * `delegationCount` reads 2. An explorer that reported "0 delegations" there
 * would be lying by omission.
 *
 * So the set of hashes comes from the registry's `AuthorityRegistered` logs, and
 * every field shown is then read back out of the registry's own storage. Still one
 * source of truth: the log tells us which hashes exist, the mapping tells us what
 * they say.
 *
 * The scan walks backwards from the head in `LOG_RANGE_LIMIT` windows and stops as
 * soon as it has seen `delegationCount` events, because that counter is the
 * registry's own statement of how many there should be. If it runs out of windows
 * first, that is reported instead of being papered over.
 */
async function registeredHashes(): Promise<{ found: Hex[]; complete: boolean }> {
  const expected = Number(
    await publicClient.readContract({
      address: registry,
      abi: authorityRegistryAbi,
      functionName: "delegationCount",
    }),
  );
  const head = await publicClient.getBlockNumber();
  const found = new Map<string, Hex>();
  let to = head;
  let windows = 0;

  while (found.size < expected && windows < MAX_WINDOWS && to > 0n) {
    const from = to >= LOG_RANGE_LIMIT ? to - LOG_RANGE_LIMIT : 0n;
    const logs = await publicClient.getContractEvents({
      address: registry,
      abi: [AUTHORITY_REGISTERED_EVENT],
      eventName: "AuthorityRegistered",
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const hash = log.args.delegationHash as Hex;
      found.set(hash.toLowerCase(), hash);
    }
    windows += 1;
    to = from === 0n ? 0n : from - 1n;
  }

  return { found: [...found.values()], complete: found.size >= expected };
}

/** Root first, so the table reads top-down the way the graph does. */
async function walk(): Promise<{ rows: { hash: Hex; meta: Meta; depth: number }[]; complete: boolean }> {
  const { found, complete } = await registeredHashes();
  const rows: { hash: Hex; meta: Meta; depth: number }[] = [];
  for (const hash of found) {
    const meta = await readMeta(hash);
    if (meta === null) continue;
    const depth = await depthOf(hash, meta);
    rows.push({ hash, meta, depth });
  }
  return {
    rows: rows.sort((a, b) => a.depth - b.depth || Number(a.meta.createdAt - b.meta.createdAt)),
    complete,
  };
}

async function depthOf(hash: Hex, meta: Meta): Promise<number> {
  if (meta.parentHash === ROOT_AUTHORITY) return 0;
  const parent = await readMeta(meta.parentHash);
  // A parent the registry no longer reports would make the depth a guess, so say
  // "at least" by returning the bound instead of an invented number.
  return parent === null ? 16 : (await depthOf(meta.parentHash, parent)) + 1;
}

function status(meta: Meta): string {
  return meta.revokedAt > 0n ? "revoked" : "live   ";
}

async function cmdTable(): Promise<void> {
  const { rows, complete } = await walk();
  const count = await publicClient.readContract({
    address: registry,
    abi: authorityRegistryAbi,
    functionName: "delegationCount",
  });

  process.stdout.write(`registry    ${registry}\nroot        ${rootDelegator}\n`);
  process.stdout.write(`registered  ${count} (cumulative, never decremented)\nrows        ${rows.length}\n\n`);
  process.stdout.write("  depth  delegation hash                                               row       isLive   delegator -> delegate\n");
  for (const { hash, meta, depth } of rows) {
    process.stdout.write(
      `  ${String(depth).padStart(5)}  ${hash}  ${status(meta)}  ` +
        `${String(await isLive(hash)).padEnd(7)}  ${meta.delegator} -> ${meta.delegate}\n`,
    );
  }
  if (!complete) {
    // A row we cannot see is the one thing an authority explorer must never hide.
    process.stdout.write(`\n  INCOMPLETE: ${count} delegations were registered but only ${rows.length} were found.\n`);
    process.stdout.write("  The log scan ran out of windows, so this table is not the whole set.\n");
  }
}

async function cmdLineage(hash: Hex): Promise<void> {
  const { chain: hops, truncated } = await buildLineage(publicClient, registry, hash);
  if (hops.length === 0) {
    process.stdout.write(`\n${hash} is not in the registry\n`);
    return;
  }
  process.stdout.write(`\n${hash}\n\n`);
  for (const [i, hop] of hops.entries()) {
    const own = hop.revokedAt > 0n;
    // A hop with revokedAt == 0 can still be unusable if an ancestor was revoked,
    // which is exactly the case the revocation scene demonstrates.
    process.stdout.write(
      `  ${String(i).padStart(2)}  ${own ? "revoked" : "live   "}  ` +
        `${hop.delegator} -> ${hop.delegate}\n      parent     ${hop.parentHash}\n` +
        `      agentId    ${hop.agentId}   created ${hop.createdAt}` +
        (own ? `   revoked ${hop.revokedAt}` : "") + `\n`,
    );
  }
  process.stdout.write(`\n  registry isLive ${await isLive(hash)}\n`);
  if (truncated) {
    // Silence here would read as "this is the whole chain", which is the failure
    // buildLineage's `truncated` flag exists to prevent.
    process.stdout.write("  WARNING truncated at maxDepth; there are hops above this that are not shown\n");
  }
}

async function cmdDescendants(hash: Hex): Promise<void> {
  const children = await descendants(hash);
  process.stdout.write(`\ndescendants of ${hash}: ${children.length}\n`);
  for (const child of children) {
    const meta = await readMeta(child);
    if (meta === null) {
      process.stdout.write(`  ${child}  row absent (never registered)\n`);
      continue;
    }
    const live = await isLive(child);
    process.stdout.write(`  ${child}  own ${status(meta)}  isLive ${live}\n`);
  }
}

async function cmdVerify(hash: Hex): Promise<void> {
  const meta = await readMeta(hash);
  if (meta === null) throw new Error(`${hash} is not registered`);
  const live = await isLive(hash);
  // Cross-check against the registry's own lineage view, so a bug in
  // buildLineage cannot make a broken chain look intact here.
  const onChain = (await publicClient.readContract({
    address: registry,
    abi: authorityRegistryAbi,
    functionName: "lineage",
    args: [hash],
  })) as readonly Meta[];
  const { chain: offs, truncated } = await buildLineage(publicClient, registry, hash);

  process.stdout.write(`\n${hash}\n`);
  process.stdout.write(`  registered  true\n`);
  process.stdout.write(`  isLive      ${live}\n`);
  process.stdout.write(`  own row     ${status(meta)}\n`);
  process.stdout.write(`  registry lineage hops ${onChain.length}\n`);
  process.stdout.write(`  local   lineage hops ${offs.length}${truncated ? " (TRUNCATED)" : ""}\n`);
  const agree = onChain.length === offs.length && !truncated;
  process.stdout.write(`  ${agree ? "both walks agree" : "WALKS DISAGREE; do not trust either as complete"}\n`);
}

/**
 * Withdraw authority as the root delegator.
 *
 * A delegation to the agent with no caveats and no delegation of its own: it
 * grants nothing, and its only execution is the registry's `revokeDelegation`.
 */
const DTK_MANAGER = "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3" as Address;
const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541" as Address;

type CompiledFixture = {
  enforcers: Record<string, Hex>;
  summary: { tokenCaps: { token: Address; perPeriodBaseUnits: string }[] };
};

const fixture: CompiledFixture = JSON.parse(
  readFileSync(new URL("../../../contracts/fixtures/wmon-spend/compiled.json", import.meta.url), "utf8"),
);

function caveatsFromFixture(): { enforcer: Address; terms: Hex; args: Hex }[] {
  const e = fixture.enforcers;
  return [
    { enforcer: needAddress("ENFORCER_ALLOWED_TARGETS"), terms: e["allowedTargets"] ?? "0x", args: "0x" },
    { enforcer: needAddress("ENFORCER_ALLOWED_METHODS"), terms: e["allowedMethods"] ?? "0x", args: "0x" },
    { enforcer: needAddress("ENFORCER_ERC20_PERIOD"), terms: e["erc20PeriodTransfer"] ?? "0x", args: "0x" },
    { enforcer: needAddress("ENFORCER_TIMESTAMP"), terms: e["timestamp"] ?? "0x", args: "0x" },
    { enforcer: needAddress("ENFORCER_LIMITED_CALLS"), terms: e["limitedCalls"] ?? "0x", args: "0x" },
    { enforcer: needAddress("SKILL_AUTHORITY_ENFORCER"), terms: e["skillAuthority"] ?? "0x", args: "0x" },
  ];
}

async function submitRaw(tx: { to: Address; data: Hex }): Promise<Hex> {
  const client = createWalletClient({ account: agent, chain: CHAIN, transport: http(MONAD_TESTNET.rpc) });
  return client.sendTransaction({
    to: tx.to,
    data: tx.data,
    chain: CHAIN,
    gas: REDEEM_GAS_LIMIT,
    ...(await fees()),
  });
}

/**
 * G9's actual claim: revoking a parent kills the whole subtree below it.
 *
 * The tree on testnet is only ever one hop deep, because `g6.ts` registers root to
 * agent and nothing registers a grandchild. `_revokeSubtree` recurses, so the
 * behaviour is real, but "it recurses" is an argument and not evidence. So this
 * registers a second root delegation and a child under it, shows the child live,
 * revokes the parent, and shows the child dead.
 *
 * The parent is signed through ERC-1271 by the root delegator and the child by the
 * agent EOA, which is the asymmetry that makes this worth testing: revocation
 * authority and grant authority are held by different parties, and a revocation
 * must reach across into the child's row regardless of who signed it.
 */
/**
 * Gas headroom the agent needs before any redeem-shaped call.
 *
 * Measured, not guessed: the redeem path is capped at `REDEEM_GAS_LIMIT` gas, and
 * at the observed 122 gwei that cap is about 0.11 MON. An account that cannot cover
 * `gas * maxFeePerGas` is refused before the transaction is ever sent, whatever the
 * call does, so the account has to hold that much. An earlier version asked for
 * four times the base fee and then doubled it again, wanted 0.70 MON from an account
 * holding 0.47, and reverted as "insufficient balance" -- a top-up that itself could
 * not be paid for.
 */
const AGENT_FUNDING_TARGET = 150_000_000_000_000_000n; // 0.15 MON

/**
 * Fund the agent from whichever demo account can afford it.
 *
 * Hardcoding USER was wrong twice over: it held 0.70 while the top-up asked 0.15,
 * then it was drained by earlier runs and could no longer cover the 0.15, so the
 * script refused instead of running. The testnet accounts are shared across every
 * gate script and get spent down, so picking the funder at run time is the only
 * version that keeps working. It also means no single low balance silently fails
 * the next run.
 */
async function ensureAgentGas(): Promise<void> {
  const have = await publicClient.getBalance({ address: agent.address });
  if (have >= AGENT_FUNDING_TARGET) return;

  const topUp = AGENT_FUNDING_TARGET - have;
  const cost = 21_000n * 200_000_000_000n;
  const candidates = [user, deployer, subAgent];

  let funder: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    const balance = await publicClient.getBalance({ address: candidate.address });
    if (balance >= topUp + cost) {
      funder = candidate;
      break;
    }
  }
  if (funder === undefined) {
    const balances = await Promise.all(
      candidates.map(async (c) => `${c.address} ${await publicClient.getBalance({ address: c.address })}`),
    );
    throw new Error(
      `the agent needs ${topUp} to reach ${AGENT_FUNDING_TARGET} and no demo account can cover it.\n` +
        `  ${balances.join("\n  ")}\n` +
        "  Fund any of them by hand rather than having a script fail partway through.",
    );
  }

  // No explicit gas or fee bounds: viem estimates, and an estimate cannot disagree
  // with the balance check the node is about to make. Pinning them is what broke
  // the first attempt.
  const client = createWalletClient({ account: funder, chain: CHAIN, transport: http(MONAD_TESTNET.rpc) });
  const hash = await client.sendTransaction({ to: agent.address, value: topUp, chain: CHAIN });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`funding the agent reverted on ${hash}`);
  process.stdout.write(`\n  funded the agent with ${topUp} base units from ${funder.address} so it can pay for gas\n  tx ${hash}\n`);
}

async function cmdScene(): Promise<void> {
  const agentClient = createWalletClient({ account: agent, chain: CHAIN, transport: http(MONAD_TESTNET.rpc) });
  await ensureAgentGas();

  const saltBase = BigInt(need("DELEGATION_SALT")) + 7_000n;
  const caveats = caveatsFromFixture();

  // Each run needs a pair of rows that are not yet registered, or the scene can
  // only ever be shown once and a second run degenerates into re-reading the first
  // run's leftovers. The first free salt wins, so the hashes stay derivable from
  // contracts/.env rather than depending on wall-clock time.
  let saltParent = saltBase;
  for (; saltParent < saltBase + 500n; saltParent += 1n) {
    const probe: Delegation = {
      delegate: agent.address,
      delegator: rootDelegator,
      authority: ROOT_AUTHORITY,
      caveats,
      salt: saltParent,
      signature: "0x",
    };
    if (!(await publicClient.readContract({ address: registry, abi: authorityRegistryAbi, functionName: "isRegistered", args: [hashDelegation(probe)] }))) break;
  }
  if (saltParent >= saltBase + 500n) throw new Error("no unused parent salt in 500 tries; raise the base");

  const unsignedParent: Delegation = {
    delegate: agent.address,
    delegator: rootDelegator,
    authority: ROOT_AUTHORITY,
    caveats,
    salt: saltParent,
    signature: "0x",
  };
  const parent: Delegation = {
    ...unsignedParent,
    signature: await user.sign({ hash: delegationTypedDataHash(unsignedParent) }),
  };
  const parentHash = hashDelegation(parent);

  const unsignedChild: Delegation = {
    delegate: subAgent.address,
    delegator: agent.address,
    authority: parentHash,
    caveats,
    salt: 1n,
    signature: "0x",
  };
  const child: Delegation = {
    ...unsignedChild,
    signature: await agent.sign({ hash: delegationTypedDataHash(unsignedChild) }),
  };
  const childHash = hashDelegation(child);

  process.stdout.write(`\nparent ${parentHash}  root -> agent\nchild  ${childHash}  agent -> subagent\n`);

  {
    // Registration estimates its own gas. It was previously sent with the redeem
    // path's 900k cap, and 900k at 200 gwei is 0.18 MON -- more than the agent
    // holds, so the node refused the transaction on the balance check before
    // looking at the calldata. An estimate for this call is around 400k.
    const h = await agentClient.writeContract({
      address: registry, abi: authorityRegistryAbi, functionName: "registerDelegation",
      args: [parent, manifestHash], chain: CHAIN,
    });
    const r = await publicClient.waitForTransactionReceipt({ hash: h });
    process.stdout.write(`  registered parent  ${h}  block ${r.blockNumber}  ${r.status}\n`);
    if (r.status !== "success") throw new Error("parent registration reverted");
  }

  {
    const h = await agentClient.writeContract({
      address: registry, abi: authorityRegistryAbi, functionName: "registerDelegation",
      args: [child, manifestHash], chain: CHAIN,
    });
    const r = await publicClient.waitForTransactionReceipt({ hash: h });
    process.stdout.write(`  registered child   ${h}  block ${r.blockNumber}  ${r.status}\n`);
    if (r.status !== "success") throw new Error("child registration reverted");
  }

  const known = await descendants(parentHash);
  process.stdout.write(`\n  descendantsOf(parent) ${known.length}, and the child is in it: ${known.some((h) => h.toLowerCase() === childHash.toLowerCase())}\n`);
  process.stdout.write(`  parent isLive ${await isLive(parentHash)}\n`);
  process.stdout.write(`  child  isLive ${await isLive(childHash)}\n`);

  await cmdRevoke(parentHash);

  const childLive = await isLive(childHash);
  const childMeta = await readMeta(childHash);
  process.stdout.write(`\n  after revoking the parent:\n`);
  process.stdout.write(`    child own row   ${status(childMeta ?? ({ revokedAt: 0n } as Meta))}\n`);
  process.stdout.write(`    child isLive    ${childLive}\n`);
  if (childLive) {
    throw new Error("G9 FAILED: the child is still live after its parent was revoked");
  }
  process.stdout.write(`    G9 holds: revoking the parent killed the child.\n`);

  // And the child cannot spend. This is the part that matters on-chain: the
  // registry's row is one input to the enforcer, so a stale "live" answer in some
  // other component would still be caught here.
  const cap = BigInt(fixture.summary.tokenCaps[0]?.perPeriodBaseUnits ?? "500000000000000000");
  const before = (await publicClient.readContract({
    address: WMON, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [rootDelegator],
  })) as bigint;
  const capCall = cap / 4n;
  const tx = buildRedeemTx({ chain: [parent, child], executions: [erc20Transfer(WMON, recipient, capCall)] });
  process.stdout.write(`\n  redeeming the chain ${capCall} WMON after revocation; must revert\n`);
  try {
    const h = await submitRaw(tx);
    const r = await publicClient.waitForTransactionReceipt({ hash: h });
    throw new Error(`G9 FAILED: the chain redeemed anyway, status ${r.status} on ${h}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("G9 FAILED")) throw error;
    // viem reports a pre-flight rejection as "Missing or invalid parameters", which
    // says nothing about why. Simulating the same call against the node returns the
    // actual revert, and that string is the evidence.
    process.stdout.write(`    node rejected it: ${message.split("\n")[0]}\n`);
    process.stdout.write(`    reason: ${await revertReason(tx)}\n`);
  }
  const after = (await publicClient.readContract({
    address: WMON, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [rootDelegator],
  })) as bigint;
  process.stdout.write(`    root WMON ${before} -> ${after}\n`);
  if (after !== before) throw new Error("a revoked chain moved tokens");
  process.stdout.write(`    nothing moved. G9 holds end to end.\n`);
}

async function cmdRevoke(hash: Hex): Promise<void> {
  const meta = await readMeta(hash);
  if (meta === null) throw new Error(`${hash} is not registered`);
  if (meta.revokedAt > 0n) {
    process.stdout.write(`\nalready revoked at ${meta.revokedAt}; nothing to do\n`);
    return;
  }

  const registryCall = encodeFunctionData({
    abi: authorityRegistryAbi,
    functionName: "revokeDelegation",
    args: [hash],
  });
  const wrapper: Delegation = {
    delegate: agent.address,
    delegator: rootDelegator,
    authority: ROOT_AUTHORITY,
    caveats: [],
    salt: REVOCATION_SALT,
    // Filled in below: the root delegator is a contract, so DTK will verify this
    // through ERC-1271 and the MultiSigDeleGator answers for its signer.
    signature: "0x",
  };
  wrapper.signature = await user.sign({ hash: delegationTypedDataHash(wrapper) });

  const tx = buildRedeemTx({ chain: [wrapper], executions: [{ target: registry, value: 0n, calldata: registryCall }] });
  const client = createWalletClient({ account: agent, chain: CHAIN, transport: http(MONAD_TESTNET.rpc) });
  const txHash = await client.sendTransaction({
    to: tx.to,
    data: tx.data,
    chain: CHAIN,
    gas: REDEEM_GAS_LIMIT,
    ...(await fees()),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  process.stdout.write(`\nrevoke ${hash}\n  tx    ${txHash}\n  block ${receipt.blockNumber}\n  status ${receipt.status}\n`);
  if (receipt.status !== "success") throw new Error("revoke reverted on chain");

  process.stdout.write(`\n  isRegistered ${await publicClient.readContract({ address: registry, abi: authorityRegistryAbi, functionName: "isRegistered", args: [hash] })} (the row stays; revocation is a field, not a delete)\n`);
  process.stdout.write(`  isLive      ${await isLive(hash)}\n`);
  const after = await readMeta(hash);
  const children = await descendants(hash);
  process.stdout.write(`  revoked at  ${after?.revokedAt.toString() ?? "unknown"}\n`);
  process.stdout.write(`  descendants ${children.length}, all now isLive false:\n`);
  for (const child of children) {
    process.stdout.write(`    ${child}  isLive ${await isLive(child)}\n`);
  }
  process.stdout.write(`\nmanifest ${manifestHash} is unrelated to this row and still live: ` +
    `${await publicClient.readContract({ address: registry, abi: authorityRegistryAbi, functionName: "liveManifests", args: [manifestHash] })}\n`);
  process.stdout.write(`recipient for a manual retry: ${recipient}\n`);
}

const USAGE = `usage: explorer <table | lineage <hash> | descendants <hash> | verify <hash> | scene | revoke <hash>>`;

async function main(): Promise<void> {
  const command = arg(0);
  switch (command) {
    case "table":
      return cmdTable();
    case "lineage":
      return cmdLineage(hexArg(arg(1), "lineage hash"));
    case "descendants":
      return cmdDescendants(hexArg(arg(1), "descendants hash"));
    case "verify":
      return cmdVerify(hexArg(arg(1), "verify hash"));
    case "scene":
      return cmdScene();
    case "revoke":
      return cmdRevoke(hexArg(arg(1), "revoke hash"));
    default:
      throw new Error(USAGE);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
  process.exit(1);
});