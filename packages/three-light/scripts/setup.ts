#!/usr/bin/env node
/**
 * 7702-delegates an EOA to the DTK deleGator, so it can act as a delegator.
 *
 * Why this is TypeScript and not a forge script: a type 0x04 transaction is an
 * RLP envelope around an authorization tuple, and forge-std has no cheatcode for
 * it. Hand-rolling that in Solidity is the kind of low-level guesswork that is
 * hard to review and easy to get subtly wrong. viem builds it correctly.
 *
 * Order matters. Run `deposit` first, while the EOA is still undelegated: once it
 * is delegated it can never lower its own balance, because `execute` only accepts
 * the EntryPoint or itself and `executeFromExecutor` only accepts the
 * DelegationManager. After this runs, the account is finished sending transactions.
 */

import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MONAD_TESTNET } from "@mandat/protocol";

const DTK_DELEGATOR = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B" as Address;
const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541" as Address;

type Env = Record<string, string | undefined>;

function loadEnv(): Env {
  const out: Env = {};
  // Both files, because they hold different things and neither is a superset:
  // contracts/.env has the chain addresses and the agent keys, the root .env has
  // the model key. First non-empty wins, so a blank line in one cannot wipe a real
  // value from the other.
  const urls = [
    new URL("../../../contracts/.env", import.meta.url),
    new URL("../../../.env", import.meta.url),
  ];
  for (const url of urls) {
    let text: string;
    try {
      text = readFileSync(url, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m?.[1] === undefined || m[2] === undefined) continue;
      if (m[2].length === 0) continue;
      if (out[m[1]] !== undefined) continue;
      out[m[1]] = m[2];
    }
  }
  return out;
}

const env = loadEnv();

function requireAddress(name: string): Address {
  const v = env[name];
  if (v === undefined || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`${name} missing or malformed in contracts/.env`);
  }
  return v as Address;
}

function requireKey(name: string): Hex {
  const v = env[name];
  if (v === undefined || !/^0x[0-9a-fA-F]{64}$/.test(v)) {
    throw new Error(`${name} missing or malformed in contracts/.env`);
  }
  return v as Hex;
}

const chain = {
  id: MONAD_TESTNET.chainId,
  name: MONAD_TESTNET.name,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_TESTNET.rpc] } },
} as const;

async function deposit(wrapWei: bigint): Promise<void> {
  const account = privateKeyToAccount(requireKey("USER_PRIVATE_KEY"));
  const client = createWalletClient({ account, chain, transport: http(MONAD_TESTNET.rpc) });

  const hash = await client.writeContract({
    address: WMON,
    abi: [
      { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
    ] as const,
    functionName: "deposit",
    value: wrapWei,
  });
  process.stdout.write(`deposit ${wrapWei} wei -> ${hash}\n`);
}

/**
 * Move WMON from USER to the root delegator.
 *
 * The missing half of `deposit`. Wrapping leaves the tokens with USER, but the
 * tokens the delegation can spend are the root's, because the delegation's
 * delegator *is* the root. `g6.ts` reads the root's balance and refuses to redeem
 * when it is zero, which it did -- twice, once on each of two days.
 *
 * Sent from USER rather than from the agent, and that is the point rather than an
 * implementation detail: the authority that decides how much the agent may spend
 * is the same party that supplies the budget. An agent able to top itself up would
 * be able to raise its own cap, and the cap would be advisory.
 */
async function fund(amount: bigint): Promise<void> {
  const account = privateKeyToAccount(requireKey("USER_PRIVATE_KEY"));
  const client = createWalletClient({ account, chain, transport: http(MONAD_TESTNET.rpc) });
  const root = requireAddress("ROOT_DELEGATOR");

  // Fees are estimated and floored rather than pinned. The base fee moved from
  // 0.102 gwei to 100 gwei during this project, and a pinned max fee below it is
  // rejected outright, so a constant here is a landmine that fires days later.
  const block = await createPublicClient({ chain, transport: http(MONAD_TESTNET.rpc) }).getBlock();
  const base = block.baseFeePerGas ?? 0n;

  const hash = await client.writeContract({
    address: WMON,
    abi: [
      { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
    ] as const,
    functionName: "transfer",
    args: [root, amount],
    maxFeePerGas: base * 2n,
    maxPriorityFeePerGas: 1_000_000_000n,
  });
  process.stdout.write(`fund root ${amount} wei -> ${hash}\n`);
}

async function delegate7702(): Promise<void> {
  const account = privateKeyToAccount(requireKey("USER_PRIVATE_KEY"));
  const client = createWalletClient({ account, chain, transport: http(MONAD_TESTNET.rpc) });

  const authorization = await client.signAuthorization({ account, contractAddress: DTK_DELEGATOR });

  const hash = await client.sendTransaction({
    authorizationList: [authorization],
    data: "0x",
    to: account.address,
  });
  process.stdout.write(`7702 -> ${DTK_DELEGATOR}\naccount ${account.address}\ntx ${hash}\n`);
  process.stdout.write(
    "Run `verify` next. On Monad testnet this reports NOT DELEGATED, because the chain\n" +
      "accepts the transaction but never applies the delegation state. working/constraints.md 11\n",
  );
}

/**
 * Reads the delegation designator, i.e. what `eth_getCode` shows for an
 * EIP-7702 delegated account: `0xef0100` followed by the delegate address.
 *
 * On Monad testnet this does not match, and that is a chain property rather
 * than a script bug: the authorization transaction is accepted and included
 * with `type: 0x04` and status success, and its gas is charged, but no
 * delegation state is stored. `eth_getCode` stays `0x` in every block, and the
 * account still answers `VERSION()` with empty data and can still send plain
 * transfers, neither of which is possible with the code installed.
 *
 * Evidence and tx hashes: working/constraints.md 11.
 */
async function codeAt(address: Address): Promise<void> {
  const res = await fetch(MONAD_TESTNET.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
  });
  const json = (await res.json()) as { result?: string };
  const code = json.result ?? "0x";
  const expected = `0xef0100${DTK_DELEGATOR.slice(2).toLowerCase()}`;
  const match = code.toLowerCase() === expected;

  process.stdout.write(`code at ${address}\n  ${code}\nexpected ${expected}\n  match: ${match}\n`);

  // `eth_getCode` is not the whole story: a chain could apply the delegation
  // and serve the designator somewhere else. Probe a function that only the
  // deleGator implements, so a false negative here is not possible.
  const probe = await fetch(MONAD_TESTNET.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: address, data: "0xffa1ad74" }, "latest"], // VERSION()
    }),
  });
  const probeJson = (await probe.json()) as { result?: string };
  const probeResult = probeJson.result ?? "0x";

  if (!match || probeResult === "0x") {
    process.stdout.write(
      "\nNOT DELEGATED. This account cannot act as a delegator: redeemDelegations calls\n" +
        "executeFromExecutor on the root delegator, and there is no code there to call.\n" +
        "Monad testnet accepts 7702 transactions without applying the delegation.\n" +
        "For G6, deploy a deleGator as an ordinary contract and use that as the root\n" +
        "delegator instead. See working/constraints.md 11.\n",
    );
    process.exitCode = 1;
  }
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === "deposit") {
    await deposit(parseEther(arg ?? "1"));
  } else if (command === "fund") {
    await fund(parseEther(arg ?? "0.5"));
  } else if (command === "delegate") {
    await delegate7702();
  } else if (command === "verify") {
    await codeAt(privateKeyToAccount(requireKey("USER_PRIVATE_KEY")).address);
  } else {
    process.stderr.write("usage: setup <deposit [MON]|fund [WMON]|delegate|verify>\n");
    process.exit(2);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
