/**
 * Run the seller and check the decisions it makes.
 *
 * Starts the process itself rather than expecting one to be running, so the
 * measurements are reproducible: a stale server on :4020 from an earlier run
 * would otherwise answer with someone else's configuration.
 */

import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  MONAD_TESTNET,
  TERMS_VERSION,
  ZERO_ADDRESS,
  ZERO_HASH,
  encodeTerms,
  hashDelegation,
  type Caveat,
  type Delegation,
} from "@mandat/protocol";

const PORT = 4031;
const AUDIT_LOG = "/tmp/mandat-audit.jsonl";

/**
 * Read contracts/.env rather than process.env.
 *
 * An earlier version read SELLER_ADDRESS from process.env, which was undefined
 * unless the caller had exported it. JSON.stringify then dropped the key and the
 * seller rejected the header for a reason that had nothing to do with the header,
 * which is a confusing way to spend an afternoon.
 */
const env: Record<string, string> = {};
for (const line of readFileSync(new URL("../../../contracts/.env", import.meta.url), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m?.[1] !== undefined && m[2] !== undefined) env[m[1]] = m[2] as string;
}
const SELLER = env["SELLER_ADDRESS"] as Address;

const ENFORCER = env["SKILL_AUTHORITY_ENFORCER"] as Address;
const TARGETS = env["ENFORCER_ALLOWED_TARGETS"] as Address;
const METHODS = env["ENFORCER_ALLOWED_METHODS"] as Address;
const PERIOD = env["ENFORCER_ERC20_PERIOD"] as Address;
const TIMESTAMP = env["ENFORCER_TIMESTAMP"] as Address;
const CALLS = env["ENFORCER_LIMITED_CALLS"] as Address;
const MANIFEST = env["MANIFEST_HASH"] as Hex;
const ROOT = `0x${"ff".repeat(32)}` as Hex;
const CAP = 50_000_000n;
/** The seller's tiers, mirroring src/seller/tiers.ts. */
/**
 * The two tiers, mirroring src/seller/tiers.ts. Cheap at 0.1 fits inside the 0.5
 * cap; expensive at 0.8 does not, and refusing that is what the demo shows.
 */
const CHEAP = 100_000_000_000_000_000n;
const EXPENSIVE = 800_000_000_000_000_000n;

const client = createPublicClient({ transport: http(MONAD_TESTNET.rpc), batch: { multicall: true } });

function word(v: bigint): string {
  return v.toString(16).padStart(64, "0");
}

const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541" as Address;

function header(overrides: { claims?: Record<string, unknown> } = {}) {
  const caveats: Caveat[] = [
    {
      enforcer: PERIOD,
      // token(20) cap(32) duration(32) startDate(32)
      terms: `0x${WMON.slice(2).toLowerCase()}${word(CAP)}${word(86_400n)}${word(0n)}`,
      args: "0x",
    },
    {
      enforcer: TIMESTAMP,
      // uint128 after, uint128 before; expiry two hours out
      terms: `0x${"0".repeat(32)}${(BigInt(Math.floor(Date.now() / 1000)) + 7200n).toString(16).padStart(32, "0")}`,
      args: "0x",
    },
    {
      enforcer: ENFORCER,
      terms: encodeTerms({ checks: 0b111, manifestHash: MANIFEST, allowedSeller: SELLER }),
      args: "0x",
    },
  ];

  const delegation: Delegation = {
    delegate: privateKeyToAccount(env["AGENT_PRIVATE_KEY"] as Hex).address,
    delegator: "0xDf9E68Bee379A298709aeb94072d1b1b9A333921" as Address,
    authority: ROOT,
    caveats,
    salt: 1n,
    signature: "0x",
  };

  return {
    version: 1,
    agentId: "1042",
    chain: `eip155:${MONAD_TESTNET.chainId}`,
    manifestCid: "bafybeiexamplecid",
    delegations: [delegation],
    claims: {
      maxPerPeriod: CAP.toString(),
      // A cap without its token is not a cap, and the seller refuses to guess
      // which one. Base units of WMON and of USDC differ by twelve orders of
      // magnitude.
      capToken: WMON,
      periodSeconds: 86_400,
      allowedSeller: SELLER,
      expiry: Math.floor(Date.now() / 1000) + 7200,
      ...overrides.claims,
    },
    signature: "0x",
  };
}

/**
 * A header whose delegation really is registered on chain.
 *
 * Built from the committed fixture rather than synthesised, because a
 * synthesised delegation is refused for being absent from the graph. That is the
 * correct answer, but it means it never reaches the payment and finality steps,
 * which are the ones this check exists to exercise.
 *
 * The signature is left empty on purpose. DTK verified the delegator's signature
 * when `registerDelegation` recorded it, and the seller looks the delegation up by
 * hash, so nothing downstream needs the signature field.
 */
function registeredHeader(): { header: ReturnType<typeof header>; hash: Hex } {
  const fixture = JSON.parse(
    readFileSync(new URL("../../../contracts/fixtures/wmon-spend/compiled.json", import.meta.url), "utf8"),
  ) as { enforcers: Record<string, Hex> };

  const delegation: Delegation = {
    delegate: privateKeyToAccount(env["AGENT_PRIVATE_KEY"] as Hex).address,
    delegator: env["ROOT_DELEGATOR"] as Address,
    authority: ROOT,
    // The fixture keys its terms by ROLE, so each blob is paired with the address
    // of that role. Pairing everything with one enforcer produced a delegation
    // that hashed differently from the registered one, and the seller reported a
    // 20-byte period term rather than "not in the graph" — which was at least
    // honest about the mismatch.
    caveats: [
      { enforcer: TARGETS, terms: fixture.enforcers["allowedTargets"] ?? "0x", args: "0x" },
      { enforcer: METHODS, terms: fixture.enforcers["allowedMethods"] ?? "0x", args: "0x" },
      { enforcer: PERIOD, terms: fixture.enforcers["erc20PeriodTransfer"] ?? "0x", args: "0x" },
      { enforcer: TIMESTAMP, terms: fixture.enforcers["timestamp"] ?? "0x", args: "0x" },
      { enforcer: CALLS, terms: fixture.enforcers["limitedCalls"] ?? "0x", args: "0x" },
      {
        enforcer: ENFORCER,
        // The fixture's terms were compiled for a specific timestamp; rebuilding
        // them here would produce a different hash and the lookup would miss.
        terms: fixture.enforcers["skillAuthority"] ?? "0x",
        args: "0x",
      },
    ],
    salt: BigInt(env["DELEGATION_SALT"] ?? "1"),
    signature: "0x",
  };

  const summary = fixture.summary as unknown as {
    notAfter: number;
    allowedSeller?: Address;
  };
  const fixtureSummary = { allowedSeller: summary.allowedSeller ?? ZERO_ADDRESS };
  return {
    header: {
      version: 1,
      agentId: "1042",
      chain: `eip155:${MONAD_TESTNET.chainId}`,
      // The CID is read from the registry, because that is where a client gets it
      // from when it publishes a manifest. Guessing it here would be caught by the
      // seller's own check, correctly.
      manifestCid: env["MANIFEST_CID"] ?? "bafybeiexamplecidwmonspend",
      delegations: [delegation],
      claims: {
        maxPerPeriod: (fixture.summary as unknown as { tokenCaps: { perPeriodBaseUnits: string }[] }).tokenCaps[0]!
          .perPeriodBaseUnits,
        capToken: WMON,
        periodSeconds: 86_400,
        // What the fixture actually encodes. The delegation was compiled without
        // naming a seller, and claiming otherwise here would be exactly the
        // over-claim the seller's recomputation exists to catch.
        allowedSeller: fixtureSummary.allowedSeller,
        expiry: summary.notAfter,
      },
      signature: "0x",
    },
    hash: hashDelegation(delegation),
  };
}

/**
 * A header carries `salt` as a bigint, which JSON.stringify refuses. Converting
 * to a decimal string matches what an actual client sends, since the wire format
 * is JSON.
 */
function toWire(header: unknown): string {
  return JSON.stringify(header, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

async function ask(path: string, extra: Record<string, string> = {}) {
  const started = Date.now();
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...extra },
  });
  const text = await res.text();
  return { status: res.status, elapsedMs: Date.now() - started, text };
}

async function main(): Promise<void> {
  rmSync(AUDIT_LOG, { force: true });

  // The seller reads contracts/.env itself when run from a shell with it
  // exported; here the values are already parsed, so pass them through rather
  // than relying on the caller's shell.
  const child = spawn("node", ["--import", "tsx", "src/seller/main.ts"], {
    env: {
      ...process.env,
      ...env,
      SELLER_PORT: String(PORT),
      CAP_TOKEN: WMON,
      SELLER_AUDIT_LOG: AUDIT_LOG,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  child.stdout.on("data", (d) => (log += String(d)));
  child.stderr.on("data", (d) => (log += String(d)));

  try {
    // Wait for the socket, not for a fixed sleep.
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/health`);
        up = res.ok;
      } catch {
        up = false;
      }
    }
    if (!up) {
      process.stdout.write(`seller did not start:\n${log}\n`);
      process.exitCode = 1;
      return;
    }
    const health = (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()) as Record<string, unknown>;
    process.stdout.write(`health: ${JSON.stringify(health)}\n\n`);

    // -- 1. No header: the 402 challenge, and nothing else.
    const challenge = await fetch(`http://127.0.0.1:${PORT}/cheap-dataset`);
    process.stdout.write(`no header           -> ${challenge.status} (expect 402)\n`);
    await challenge.text();

    // -- 2. A tampered cap. The seller must read the delegation, not the header.
    const tamperedHeader = toWire(header({ claims: { maxPerPeriod: "800000000" } }));
    const tampered = await ask("/cheap-dataset", { "x-authority-header": tamperedHeader });
    process.stdout.write(`tampered cap        -> ${tampered.status} in ${tampered.elapsedMs}ms\n`);
    process.stdout.write(`  ${tampered.text.slice(0, 160)}\n`);

    // -- 3. The delegation that really is registered, with no payment supplied.
    //     Previously this returned 200 and the paid answer.
    // The expensive tier is priced above the cap on purpose, so the refusal is the
    // interesting outcome and not an accident of arithmetic.
    const registered = registeredHeader();
    const isRegistered = await client.readContract({
      address: env["AUTHORITY_REGISTRY"] as Address,
      abi: [{ type: "function", name: "isRegistered", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] }],
      functionName: "isRegistered",
      args: [registered.hash],
    });
    process.stdout.write(`\nregistered delegation ${registered.hash.slice(0, 18)}… -> isRegistered ${isRegistered}\n`);

    let unpaid;
    try {
      unpaid = await ask("/cheap-dataset", { "x-authority-header": toWire(registered.header) });
    } catch (error) {
      // The seller's own stderr is the only place the cause will be.
      process.stdout.write(`\nrequest failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.stdout.write(`--- seller log ---\n${log}\n--- end ---\n`);
      return;
    }
    process.stdout.write(`registered, unpaid   -> ${unpaid.status} in ${unpaid.elapsedMs}ms (expect 425, was 200)\n`);
    process.stdout.write(`  ${unpaid.text.slice(0, 200)}\n`);

    // -- 3a. The tier above the cap. This is the decision the demo turns on: the
    //      cap is 0.5 and the expensive tier costs 0.8, in the same token, so the
    //      seller refuses before doing any expensive work.
    const expensive = await ask("/expensive-dataset", {
      "x-authority-header": toWire(registered.header),
    });
    process.stdout.write(`registered, expensive-> ${expensive.status} (expect 403, cap 0.5 < 0.8)\n`);
    process.stdout.write(`  ${expensive.text.slice(0, 200)}\n`);

    // -- 3b. Same delegation, claiming a cap the terms do not allow.
    const inflated = { ...registered.header, claims: { ...registered.header.claims, maxPerPeriod: "800000000" } };
    const inflatedRes = await ask("/cheap-dataset", { "x-authority-header": toWire(inflated) });
    process.stdout.write(`registered, inflated -> ${inflatedRes.status} (expect 403)\n`);
    process.stdout.write(`  ${inflatedRes.text.slice(0, 160)}\n`);

    // -- 4. Expired.
    const expiredHeader = toWire(header({ claims: { expiry: 1_700_000_000 } }));
    const expired = await ask("/cheap-dataset", { "x-authority-header": expiredHeader });
    process.stdout.write(`expired             -> ${expired.status}\n`);
    if (expired.status >= 500) process.stdout.write(`  ${expired.text.slice(0, 200)}\n`);

    // -- 5. Header for another chain: refused without spending RPC.
    const wrongChain = await ask("/cheap-dataset", {
      "x-authority-header": toWire({ ...header(), chain: "eip155:1" }),
    });
    process.stdout.write(`wrong chain         -> ${wrongChain.status} in ${wrongChain.elapsedMs}ms\n`);

    // -- 6. Latency, measured against a real delegation on chain.
    const live = registered.header;
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await ask("/cheap-dataset", { "x-authority-header": toWire(live) });
      samples.push(res.elapsedMs);
    }
    process.stdout.write(`\nlatency over 5 runs: ${samples.join("ms, ")}ms\n`);
    process.stdout.write(`  worst ${Math.max(...samples)}ms (budget 1000ms)\n`);

    // -- 7. The audit trail, signed.
    await sleep(300);
    const lines = readFileSync(AUDIT_LOG, "utf8").trim().split("\n").filter(Boolean);
    process.stdout.write(`\naudit records: ${lines.length}\n`);
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    process.stdout.write(`  fields: ${Object.keys(first).join(", ")}\n`);
    process.stdout.write(`  signed: ${first["signed"]}, has hash: ${first["auditHash"] !== undefined}\n`);
    const anyDenied = lines.some((l) => JSON.parse(l).allowed === false);
    process.stdout.write(`  contains a denial: ${anyDenied}\n`);
  } finally {
    const stderr = log.split("\n").filter((l) => l.includes("Error") || l.includes("at "));
    if (stderr.length > 0) {
      process.stdout.write(`\n--- seller stderr ---\n${stderr.slice(0, 10).join("\n")}\n`);
    }
    child.kill("SIGINT");
    await sleep(500);
    child.kill("SIGKILL");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});