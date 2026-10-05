#!/usr/bin/env node
/**
 * G6: the two transactions the whole project exists to produce.
 *
 * One redemption inside the cap that succeeds and moves tokens, one outside it
 * that reverts on-chain. The revert has to come from the caveat enforcer, not
 * from us: a middleware that refuses a request proves only that the middleware
 * works.
 *
 * Why this is a TypeScript script and not a forge script: the root delegator is
 * a contract, so its delegation is signed through ERC-1271 rather than ECDSA,
 * and the redemption is signed by the agent EOA that pays gas. `redeem.ts`
 * already builds and is tested against the real `redeemDelegations` encoding, so
 * the calldata here is the same one the tests assert.
 *
 * Why the root delegator is a contract at all: Monad testnet accepts EIP-7702
 * transactions but never stores the delegation, so an EOA cannot carry the
 * `executeFromExecutor` that redemption needs. Evidence in
 * working/constraints.md 11.
 *
 * Order matters and the reasons are not obvious:
 *
 *   1. The root delegator must hold WMON before any redemption. A contract that
 *      holds nothing has nothing to spend.
 *   2. The manifest must be live before the delegation is registered, or the
 *      MANIFEST check refuses it at redemption time instead of registration.
 *   3. The agent must be bound before redemption, or the IDENTITY check refuses
 *      the redeemer.
 */

import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  MONAD_TESTNET,
  buildRedeemTx,
  delegationTuple,
  delegationTypedDataHash,
  erc20Transfer,
  hashDelegation,
  type Caveat,
  type Delegation,
} from "@mandat/protocol";

const CHAIN = {
  id: MONAD_TESTNET.chainId,
  name: MONAD_TESTNET.name,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_TESTNET.rpc] } },
} as const;

const DTK_MANAGER = "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3" as Address;
const DTK_DELEGATOR_7702 = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B" as Address;
const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541" as Address;
const ROOT_AUTHORITY = `0x${"ff".repeat(32)}` as Hex;

/** Spends and the over-cap attempt, both as raw base units of WMON. */
const WITHIN_CAP = 100_000_000_000_000_000n; // 0.1 WMON, cap is 0.5
const OVER_CAP = 800_000_000_000_000_000n; // 0.8 WMON, over the 0.5 cap

/**
 * Separate from DELEGATION_SALT so the self-revocation delegation cannot collide
 * with the spending one. Any distinct value works; the only requirement is that
 * the two hash differently.
 */
const REVOCATION_SALT = 9999n;

type Env = Record<string, string | undefined>;

function loadEnv(): Env {
  const out: Env = {};
  for (const line of readFileSync(new URL("../../../contracts/.env", import.meta.url), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m?.[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnv();

function need(name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} missing in contracts/.env`);
  }
  return value;
}

function needKey(name: string): Hex {
  const value = need(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} is not a private key in contracts/.env`);
  }
  return value as Hex;
}

function needAddress(name: string): Address {
  const value = need(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} is not an address`);
  return value as Address;
}

const publicClient = createPublicClient({ transport: http(MONAD_TESTNET.rpc) });

/**
 * Send a prebuilt {to, data} pair.
 *
 * `writeContract` on a wallet client is typed only for ABIs it can resolve, and a
 * raw pair is what `redeem.ts` produces, so this skips the ABI layer entirely.
 */
/**
 * Fee bounds, stated rather than estimated.
 *
 * `sendTransaction` without them asks the node for a suggested price, and on this
 * endpoint that came back high enough that a 0.34 MON account reported "insufficient
 * balance" for a transaction that costs about 0.00005 MON. A redemption that
 * cannot be sent is not a redemption, and the fee is our choice to make.
 *
 * Both figures are far above the observed 0.1 gwei base fee and below anything
 * that would make a 0.3 MON balance look small.
 */
const MAX_FEE_PER_GAS = 20_000_000_000n; // 20 gwei
const MAX_PRIORITY_FEE = 1_000_000_000n; // 1 gwei
const REDEEM_GAS_LIMIT = 900_000n;

async function submitTransaction(
  account: ReturnType<typeof privateKeyToAccount>,
  tx: { to: Address; data: Hex },
): Promise<Hex> {
  const client = createWalletClient({ account, chain: CHAIN, transport: http(MONAD_TESTNET.rpc) });
  return client.sendTransaction({
    to: tx.to,
    data: tx.data,
    chain: CHAIN,
    gas: REDEEM_GAS_LIMIT,
    maxFeePerGas: MAX_FEE_PER_GAS,
    maxPriorityFeePerGas: MAX_PRIORITY_FEE,
  });
}

const deployer = privateKeyToAccount(needKey("DEPLOYER_PRIVATE_KEY"));
const user = privateKeyToAccount(needKey("USER_PRIVATE_KEY"));
const agent = privateKeyToAccount(needKey("AGENT_PRIVATE_KEY"));
const subAgent = privateKeyToAccount(needKey("SUBAGENT_PRIVATE_KEY"));
const deployerClient = createWalletClient({ account: deployer, chain: CHAIN, transport: http(MONAD_TESTNET.rpc) });

const registry = needAddress("AUTHORITY_REGISTRY");
const enforcers = {
  allowedTargets: needAddress("ENFORCER_ALLOWED_TARGETS"),
  allowedMethods: needAddress("ENFORCER_ALLOWED_METHODS"),
  erc20PeriodTransfer: needAddress("ENFORCER_ERC20_PERIOD"),
  timestamp: needAddress("ENFORCER_TIMESTAMP"),
  limitedCalls: needAddress("ENFORCER_LIMITED_CALLS"),
  skillAuthority: needAddress("SKILL_AUTHORITY_ENFORCER"),
};
const manifestHash = need("MANIFEST_HASH") as Hex;
const rootDelegator = needAddress("ROOT_DELEGATOR");
const recipient = subAgent.address; // a real account we control, so the transfer is observable

/** The compiled fixture, so the on-chain envelope is the committed one. */
type CompiledFixture = {
  enforcers: Record<string, Hex>;
  summary: {
    targets: Address[];
    selectors: Hex[];
    tokenCaps: { token: Address; perPeriodBaseUnits: string; periodSeconds: number; startDate: number }[];
    notAfter: number;
    maxCalls: number | null;
    manifestHash: Hex;
  };
};

const fixture: CompiledFixture = JSON.parse(
  readFileSync(new URL("../../../contracts/fixtures/wmon-spend/compiled.json", import.meta.url), "utf8"),
);

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const REGISTRY_ABI = [
  { type: "function", name: "registerManifest", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "string" }], outputs: [] },
  { type: "function", name: "liveManifests", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "bindAgent", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "agentIdOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  // Reuse the ABI's own tuple definitions rather than spelling them out. viem
  // maps an object onto ABI components by name, and unnamed components have no
  // name to map to, so a hand-written unnamed tuple silently reads `undefined`
  // for every field.
  {
    type: "function",
    name: "registerDelegation",
    stateMutability: "nonpayable",
    inputs: [
      { type: "tuple", components: delegationTuple },
      { type: "bytes32" },
    ],
    outputs: [],
  },
  { type: "function", name: "isRegistered", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isLive", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "delegationCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "revokeDelegation", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "authorities", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "tuple", components: [{ type: "address", name: "delegator" }, { type: "address", name: "delegate" }, { type: "uint256", name: "agentId" }, { type: "bytes32", name: "parentHash" }, { type: "bytes32", name: "manifestHash" }, { type: "uint64", name: "createdAt" }, { type: "uint64", name: "revokedAt" }] }] },
] as const;

/**
 * The caveats, read from the committed fixture rather than rebuilt here.
 *
 * A second encoder would be a second source of truth, and the fixture is what
 * `contracts/test/CompiledEnvelope.t.sol` already checks against the live
 * enforcers' own `getTermsInfo`.
 */
function caveatsFromFixture(): Caveat[] {
  const e = fixture.enforcers;
    return [
    { enforcer: enforcers.allowedTargets, terms: e["allowedTargets"] ?? "0x", args: "0x" },
    { enforcer: enforcers.allowedMethods, terms: e["allowedMethods"] ?? "0x", args: "0x" },
    { enforcer: enforcers.erc20PeriodTransfer, terms: e["erc20PeriodTransfer"] ?? "0x", args: "0x" },
    { enforcer: enforcers.timestamp, terms: e["timestamp"] ?? "0x", args: "0x" },
    { enforcer: enforcers.limitedCalls, terms: e["limitedCalls"] ?? "0x", args: "0x" },
    { enforcer: enforcers.skillAuthority, terms: e["skillAuthority"] ?? "0x", args: "0x" },
  ];
}

/**
 * A delegation from the contract root delegator to an agent EOA.
 *
 * `signature` is filled in by the caller because it depends on the key.
 */
function buildDelegation(delegate: Address, salt: bigint, caveats: Caveat[], parentHash: Hex): Delegation {
  return {
    delegate,
    delegator: rootDelegator,
    authority: parentHash,
    caveats,
    salt,
    signature: "0x",
  };
}

/**
 * Sign a delegation the way the root delegator will verify it.
 *
 * DTK branches on `delegator.code.length`: with code it calls ERC-1271, and the
 * MultiSigDeleGator answers for its signer. The digest is DTK's own EIP-712
 * domain over the delegation hash, exactly as `redeemDelegations` will compute it.
 */
async function signAsRootDelegator(delegation: Delegation): Promise<Delegation> {
  const digest = delegationTypedDataHash(delegation);
  const signature = await user.sign({ hash: digest });
  return { ...delegation, signature };
}

/**
 * Revoke by redeeming a delegation that delegates nothing.
 *
 * `revokeDelegation` checks `msg.sender == meta.delegator`, and the delegator is
 * a `MultiSigDeleGator`, not an EOA. Calling the registry directly from the user's
 * EOA would revert with `NotYourDelegation`, which is the correct answer: a
 * delegator that is a contract can only act through its own entry points.
 *
 * Those entry points are narrow on purpose. `DeleGatorCore.execute` is
 * `onlyEntryPoint`, and the other admin functions are `onlyEntryPointOrSelf`, so
 * a signer cannot call them either. Observed directly: calling `execute` from the
 * user's EOA reverts with `NotEntryPoint()` (`0xd663742a`).
 *
 * What remains is the path DTK intends for a contract delegator:
 * `redeemDelegations` on the DelegationManager, which validates the chain,
 * calls the enforcers, and then calls `executeFromExecutor` on the root delegator
 * because the manager is the only caller allowed to. Redeeming a delegation whose
 * target is `revokeDelegation` on our own registry therefore revokes it, using
 * the same mechanism the demo uses to spend.
 *
 * This is the one place the demo is self-referential: the revocation is enforced
 * by the same code path being demonstrated. That is worth stating plainly in the
 * README rather than presenting revocation as an independent mechanism.
 */
async function revokeByRootDelegator(delegationHash: Hex): Promise<Hex> {
  const registryCall = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: "revokeDelegation",
    args: [delegationHash],
  });
  const selfRevoke: Delegation = await signAsRootDelegator({
    delegate: agent.address,
    delegator: rootDelegator,
    authority: ROOT_AUTHORITY,
    caveats: [],
    // A distinct salt, so this delegation hashes differently and its signature
    // cannot be confused with the spending one.
    salt: REVOCATION_SALT,
    signature: "0x",
  });

  const tx = buildRedeemTx({
    chain: [selfRevoke],
    executions: [{ target: registry, value: 0n, calldata: registryCall }],
  });
  return submitTransaction(agent, tx);
}

async function balanceOf(address: Address): Promise<bigint> {
  return publicClient.readContract({ address: WMON, abi: ERC20_ABI, functionName: "balanceOf", args: [address] });
}

async function sendAndConfirm(hash: Hex, label: string): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  process.stdout.write(`${label}\n  tx    ${hash}\n  block ${receipt.blockNumber}\n  status ${receipt.status}\n`);
  if (receipt.status !== "success") throw new Error(`${label} reverted on chain`);
}

async function main(): Promise<void> {
  const step = process.argv[2] ?? "all";
  process.stdout.write(`chain ${CHAIN.id} (${MONAD_TESTNET.name})\n`);
  process.stdout.write(`root delegator   ${rootDelegator}\n`);
  process.stdout.write(`user EOA signer  ${user.address}\n`);
  process.stdout.write(`agent (gas)      ${agent.address}\n`);
  process.stdout.write(`sub-agent        ${subAgent.address}\n`);
  process.stdout.write(`registry         ${registry}\n`);
  process.stdout.write(`manifestHash     ${manifestHash}\n\n`);

  // -- 1. the root delegator must hold the token it is authorised to spend.
  const rootBalance = await balanceOf(rootDelegator);
  process.stdout.write(`root WMON balance ${rootBalance}\n`);
  if (rootBalance === 0n) {
    throw new Error("root delegator holds no WMON; fund it before redeeming");
  }

  // -- 2. publish the consent document. Registration is permissionless but the
  //    MANIFEST check reads this flag at redemption time.
  const live = await publicClient.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "liveManifests",
    args: [manifestHash],
  });
  if (!live) {
    const hash = await deployerClient.writeContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "registerManifest",
      args: [manifestHash, "bafybeiexamplecidwmonspend"],
      chain: CHAIN,
    });
    await sendAndConfirm(hash, "registerManifest");
  } else {
    process.stdout.write("registerManifest  already live, skipped\n");
  }

  // -- 3. bind identities. The IDENTITY check reads agentIdOf at redemption time.
  const agentId = await publicClient.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "agentIdOf",
    args: [agent.address],
  });
  if (agentId === 0n) {
    const hash = await deployerClient.writeContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "bindAgent",
      args: [agent.address, 1042n],
      chain: CHAIN,
    });
    await sendAndConfirm(hash, "bindAgent(agent)");
  } else {
    process.stdout.write(`bindAgent(agent)  already bound, id ${agentId}\n`);
  }

  const subAgentId = await publicClient.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "agentIdOf",
    args: [subAgent.address],
  });
  if (subAgentId === 0n) {
    const hash = await deployerClient.writeContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "bindAgent",
      args: [subAgent.address, 1043n],
      chain: CHAIN,
    });
    await sendAndConfirm(hash, "bindAgent(sub-agent)");
  }

  const agentClient = createWalletClient({
    account: agent,
    chain: CHAIN,
    transport: http(MONAD_TESTNET.rpc),
  });
  const submitRaw = (tx: { to: Address; data: Hex }): Promise<Hex> => submitTransaction(agent, tx);

  // -- 4. register the delegation. Signature is ERC-1271, verified by the
  //    registry at AuthorityRegistry.sol:112-115 because the delegator has code.
  const salt = BigInt(need("DELEGATION_SALT") ?? "1");
  const caveats = caveatsFromFixture();
  const unsigned = buildDelegation(agent.address, salt, caveats, ROOT_AUTHORITY);
  const delegation = await signAsRootDelegator(unsigned);
  const delegationHash = hashDelegation(delegation);

  const already = await publicClient.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "isRegistered",
    args: [delegationHash],
  });
  if (already) {
    process.stdout.write(`registerDelegation already registered, hash ${delegationHash}\n\n`);
  } else {
    const hash = await agentClient.writeContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "registerDelegation",
      args: [delegation, manifestHash],
      chain: CHAIN,
    });
    await sendAndConfirm(hash, "registerDelegation");
    process.stdout.write(`  delegationHash ${delegationHash}\n`);
  }

  // -- 5. the two transactions.
  if (step === "all" || step === "within") {
    const before = await balanceOf(rootDelegator);
    const recipientBefore = await balanceOf(recipient);
    const tx = buildRedeemTx({
      chain: [delegation],
      executions: [erc20Transfer(WMON, recipient, WITHIN_CAP)],
    });
    process.stdout.write(`\nredeem ${WITHIN_CAP} WMON (cap ${fixture.summary.tokenCaps[0]?.perPeriodBaseUnits})\n`);
    process.stdout.write(`  root WMON ${before} -> expecting ${before - WITHIN_CAP}\n`);
    const hash = await submitRaw(tx);
    await sendAndConfirm(hash, "redeem WITHIN cap");
    const after = await balanceOf(rootDelegator);
    const recipientAfter = await balanceOf(recipient);
    process.stdout.write(`  root WMON now ${after}\n`);
    process.stdout.write(`  recipient ${recipientBefore} -> ${recipientAfter}\n`);
    if (after !== before - WITHIN_CAP) {
      throw new Error("T13 FAILED: the balance did not move by the amount spent");
    }
    process.stdout.write("  T13 satisfied: the balance really changed\n");
  }

  if (step === "all" || step === "over") {
    const before = await balanceOf(rootDelegator);
    const tx = buildRedeemTx({
      chain: [delegation],
      executions: [erc20Transfer(WMON, recipient, OVER_CAP)],
    });
    process.stdout.write(`\nredeem ${OVER_CAP} WMON (over the cap)\n`);
    try {
      const hash = await submitRaw(tx);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      throw new Error(
        `T2 FAILED: expected a revert, got status ${receipt.status} on ${hash}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("T2 FAILED")) throw error;
      process.stdout.write(`  reverted as expected\n`);
      process.stdout.write(`  reason: ${message.slice(0, 300)}\n`);
    }
    const after = await balanceOf(rootDelegator);
    process.stdout.write(`  root WMON ${before} -> ${after}\n`);
    if (after !== before) throw new Error("a reverted redemption moved tokens");
    process.stdout.write("  nothing moved, as required\n");
  }

  if (step === "all" || step === "revoke") {
    // Scene 4: the user withdraws the delegation, and the next attempt must fail.
    // Revocation is the delegator's right, so this is signed by the root
    // delegator through ERC-1271, not by us.
    const meta = await publicClient.readContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "authorities",
      args: [delegationHash],
    });
    if (meta.revokedAt > 0n) {
      process.stdout.write(`\nalready revoked at ${meta.revokedAt}\n`);
    } else {
      const hash = await revokeByRootDelegator(delegationHash);
      await sendAndConfirm(hash, "revokeDelegation");
    }

    process.stdout.write(`  isRegistered ${await publicClient.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "isRegistered", args: [delegationHash] })} (baris masih ada)\n`);
    process.stdout.write(`  isLive      ${await publicClient.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "isLive", args: [delegationHash] })} (tidak ada lagi)\n`);

    const balanceBefore = await balanceOf(rootDelegator);
    const tx = buildRedeemTx({
      chain: [delegation],
      executions: [erc20Transfer(WMON, recipient, WITHIN_CAP)],
    });
    process.stdout.write(`\nredeem ${WITHIN_CAP} WMON after revocation\n`);
    try {
      const hash = await submitRaw(tx);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      throw new Error(`FAILED: expected a revert, got status ${receipt.status} on ${hash}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("FAILED")) throw error;
      process.stdout.write(`  reverted as expected\n  reason: ${message.slice(0, 260)}\n`);
    }
    const balanceAfter = await balanceOf(rootDelegator);
    process.stdout.write(`  root WMON ${balanceBefore} -> ${balanceAfter}\n`);
    if (balanceAfter !== balanceBefore) throw new Error("a revoked delegation still moved tokens");
  }

  process.stdout.write(`\ndelegationCount ${await publicClient.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "delegationCount" })}\n`);
}

main().catch((error) => {
  // The viem address error names no variable, which makes it slow to trace.
  // The stack does.
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
