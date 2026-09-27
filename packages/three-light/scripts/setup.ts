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
import { createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MONAD_TESTNET } from "@mandat/protocol";

const DTK_DELEGATOR = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B" as Address;
const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541" as Address;

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
    "This account can no longer send transactions of its own. Check the code at its\n" +
      "address reads 0xef0100 followed by the deleGator.\n",
  );
}

async function codeAt(address: Address): Promise<void> {
  const res = await fetch(MONAD_TESTNET.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
  });
  const json = (await res.json()) as { result?: string };
  const code = json.result ?? "0x";
  const expected = `0xef0100${DTK_DELEGATOR.slice(2).toLowerCase()}`;
  process.stdout.write(`code at ${address}\n  ${code}\nexpected ${expected}\n  match: ${code.toLowerCase() === expected}\n`);
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === "deposit") {
    await deposit(parseEther(arg ?? "1"));
  } else if (command === "delegate") {
    await delegate7702();
  } else if (command === "verify") {
    await codeAt(privateKeyToAccount(requireKey("USER_PRIVATE_KEY")).address);
  } else {
    process.stderr.write("usage: setup <deposit [MON]|delegate|verify>\n");
    process.exit(2);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
