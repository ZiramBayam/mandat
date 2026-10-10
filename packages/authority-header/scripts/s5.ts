#!/usr/bin/env node
/**
 * S5: the self-limiting agent, run for real and recorded.
 *
 * The loop, per run:
 *
 *   1. Build the Authority Header from the delegation that is registered on chain.
 *   2. `get_my_authority()` -- the agent reads its own cap through the seller's
 *      verification path, so the number it sees is recomputed from the caveats
 *      and confirmed against chain rather than asserted by the header.
 *   3. Hand that to Gemini at temperature 0 and ask which resource it will buy.
 *      The model returns a tier NAME. The price is looked up here, never by the
 *      model.
 *   4. Redeem the tier it chose on chain.
 *   5. Separately, attempt the tier it was asked for, so the record contains the
 *      revert as well as the decision.
 *
 * Step 5 is not a test of the model. It is the unconditional part: 0.8 WMON
 * against a 0.5 cap reverts whatever Gemini said. If the model happens to choose
 * the expensive tier, step 4 is the one that reverts, and the run is recorded as
 * a failure rather than quietly scored as a pass.
 *
 * Five runs are attempted so that throttling on the free tier does not leave the
 * recording short. Clean runs are kept, not the first three.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  MONAD_TESTNET,
  buildRedeemTx,
  erc20Transfer,
  hashDelegation,
  type Address,
  type Delegation,
  type Hex,
} from "@mandat/protocol";
import { createPublicClient, createWalletClient, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildS5Prompt,
  getMyAuthority,
  parseAgentDecision,
} from "../src/agent/authority.js";
import { explainRevert } from "../src/protocol/revertReason.js";
import type { SellerConfig } from "../src/protocol/verify.js";

const ROOT = `0x${"ff".repeat(32)}` as Hex;
const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541" as Address;
const REDEEM_GAS_LIMIT = 900_000n;
const RUNS = 5;

/**
 * The two tiers, priced in base units of the cap token.
 *
 * The expensive one is deliberately above the 0.5 cap. That is not a limitation of
 * the demo; it is the condition being demonstrated.
 */
const TIERS = [
  { name: "cheap-dataset", price: 100_000_000_000_000_000n }, // 0.1
  { name: "expensive-dataset", price: 800_000_000_000_000_000n }, // 0.8
] as const;

type Env = Record<string, string | undefined>;

function loadEnv(): Env {
  const out: Env = {};
  // contracts/.env first, then the root .env, so the root can override. Keys exist
  // in only one of the two by design -- see .env.example -- and a duplicate here
  // would silently prefer one file's value with nothing to say so.
  const urls = [
    new URL("../../../contracts/.env", import.meta.url),
    new URL("../../../.env", import.meta.url),
  ];
  for (const url of urls) {
    let text: string;
    try {
      text = readFileSync(url, "utf8");
    } catch {
      continue; // a missing root .env is fine; only the model key lives there
    }
    for (const line of text.split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m?.[1] === undefined || m[2] === undefined) continue;
      // First non-empty wins, and an empty assignment never overwrites.
      //
      // The root .env carries the four private keys as blank lines -- they are
      // documented as belonging in contracts/.env and this file keeps the names
      // for discoverability. Under plain "later file wins" those blanks silently
      // wiped four real keys, and the run failed with "AGENT_PRIVATE_KEY is not
      // set" while the value sat in the other file the whole time.
      if (m[2].length === 0) continue;
      if (out[m[1]] !== undefined) continue;
      out[m[1]] = m[2];
    }
  }
  return out;
}

const env = loadEnv();

function need(name: string): string {
  const v = env[name];
  if (v === undefined || v.length === 0) throw new Error(`${name} is not set`);
  return v;
}

const publicClient = createPublicClient({
  chain: MONAD_TESTNET,
  transport: http(MONAD_TESTNET.rpc),
}) as PublicClient;

const agent = privateKeyToAccount(need("AGENT_PRIVATE_KEY") as Hex);

/**
 * The header, built from the delegation registered on chain.
 *
 * From the fixture rather than synthesised: a delegation that was never
 * registered is refused for being absent from the authority graph, which is the
 * right answer and useless for this.
 */
function buildHeader() {
  const fixture = JSON.parse(
    readFileSync(new URL("../../../contracts/fixtures/wmon-spend/compiled.json", import.meta.url), "utf8"),
  ) as {
    enforcers: Record<string, Hex>;
    summary: { notAfter: number; allowedSeller?: Address; tokenCaps: { perPeriodBaseUnits: string }[] };
  };

  const pair = (role: keyof typeof ROLE_ENV): { enforcer: Address; terms: Hex; args: Hex } => ({
    enforcer: env[ROLE_ENV[role]] as Address,
    terms: fixture.enforcers[role] ?? "0x",
    args: "0x",
  });

  const delegation: Delegation = {
    delegate: agent.address,
    delegator: env["ROOT_DELEGATOR"] as Address,
    authority: ROOT,
    caveats: [
      pair("allowedTargets"),
      pair("allowedMethods"),
      pair("erc20PeriodTransfer"),
      pair("timestamp"),
      pair("limitedCalls"),
      pair("skillAuthority"),
    ],
    salt: BigInt(env["DELEGATION_SALT"] ?? "1"),
    signature: "0x",
  };

  return {
    hash: hashDelegation(delegation),
    delegation,
    header: {
      version: 1,
      agentId: "1042",
      chain: `eip155:${MONAD_TESTNET.chainId}`,
      manifestCid: env["MANIFEST_CID"] ?? "bafybeiexamplecidwmonspend",
      delegations: [delegation],
      claims: {
        maxPerPeriod: fixture.summary.tokenCaps[0]!.perPeriodBaseUnits,
        capToken: WMON,
        periodSeconds: 86_400,
        allowedSeller: fixture.summary.allowedSeller ?? "0x0000000000000000000000000000000000000000",
        expiry: fixture.summary.notAfter,
      },
      signature: "0x",
    },
  };
}

const ROLE_ENV = {
  allowedTargets: "ENFORCER_ALLOWED_TARGETS",
  allowedMethods: "ENFORCER_ALLOWED_METHODS",
  erc20PeriodTransfer: "ENFORCER_ERC20_PERIOD",
  timestamp: "ENFORCER_TIMESTAMP",
  limitedCalls: "ENFORCER_LIMITED_CALLS",
  skillAuthority: "SKILL_AUTHORITY_ENFORCER",
} as const;

function sellerConfig(): SellerConfig {
  return {
    chainId: MONAD_TESTNET.chainId,
    seller: (env["SELLER_ADDRESS"] ?? "0x0000000000000000000000000000000000000000") as Address,
    requestedTier: TIERS[0].name,
    registry: env["AUTHORITY_REGISTRY"] as Address,
    skillEnforcer: env["SKILL_AUTHORITY_ENFORCER"] as Address,
    erc20PeriodEnforcer: env["ENFORCER_ERC20_PERIOD"] as Address,
    timestampEnforcer: env["ENFORCER_TIMESTAMP"] as Address,
    tiers: TIERS.map((t) => ({ name: t.name, price: t.price, token: WMON, releaseAt: "Finalized" as const })),
  };
}

async function fees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const block = await publicClient.getBlock();
  const estimate = await publicClient.estimateFeesPerGas();
  const base = block.baseFeePerGas ?? 0n;
  const suggested = estimate.maxFeePerGas ?? 0n;
  return {
    maxFeePerGas: suggested > base * 2n ? suggested : base * 2n,
    maxPriorityFeePerGas: estimate.maxPriorityFeePerGas ?? 1_000_000_000n,
  };
}

/**
 * Redeem a WMON transfer through the delegation.
 *
 * Returns the outcome rather than throwing, because "it reverted" is a result the
 * recording needs, not an error to be swallowed.
 */
async function redeem(
  delegation: Delegation,
  amount: bigint,
): Promise<{ outcome: "mined-success" | "mined-reverted" | "rejected"; tx?: Hex; reason?: string }> {
  const recipient = env["SELLER_ADDRESS"] as Address;
  const tx = buildRedeemTx({ chain: [delegation], executions: [erc20Transfer(WMON, recipient, amount)] });
  const client = createWalletClient({ account: agent, chain: MONAD_TESTNET, transport: http(MONAD_TESTNET.rpc) });
  try {
    const hash = await client.sendTransaction({
      to: tx.to,
      data: tx.data,
      chain: MONAD_TESTNET,
      gas: REDEEM_GAS_LIMIT,
      ...(await fees()),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return receipt.status === "success"
      ? { outcome: "mined-success", tx: hash }
      : { outcome: "mined-reverted", tx: hash };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { outcome: "rejected", reason: explainRevert(message) };
  }
}

type GeminiReply = { tier: string; reasoning: string; raw: string };

/**
 * One model call.
 *
 * `get_my_authority()` is injected as a real tool result rather than described in
 * the prose. The model is shown the numbers the chain returned, which is the part
 * that has to be real: a prompt saying "your cap is 0.5" would make the downgrade
 * unfalsifiable.
 */
async function askModel(capDescription: string): Promise<GeminiReply> {
  const apiKey = need("GEMINI_API_KEY");
  const model = env["GEMINI_MODEL"] ?? "gemini-3.8-flash";
  // No code fence, no prose, and a bounded reasoning length.
  //
  // The original shape asked for "one sentence" with maxOutputTokens 256. Gemini
  // opened a \x60\x60\x60json fence and spent the budget writing inside it, so the reply
  // was truncated mid-object on every run and unparseable. That presented as "the
  // agent never decided", when the real fault was a token limit too small for the
  // format we asked for.
  const prompt = `${buildS5Prompt(TIERS)}

Result of get_my_authority():
${capDescription}

Reply with a single JSON object and nothing else. No code fence, no prose.
Shape: {"tier": "<a resource name from the list above>", "reasoning": "<one short sentence>"}
Keep reasoning under 20 words so the object is not truncated.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 },
      }),
    },
  );

  if (response.status === 429 || response.status === 503) {
    throw new Error(`GEMINI THROTTLED: ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`gemini returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const parsed = parseAgentDecision(text, TIERS.map((t) => t.name));
  return { ...parsed, raw: text };
}

type RunRecord = {
  run: number;
  model: string;
  temperature: number;
  capReadByAgent: string;
  capToken: Address;
  sellerAllowsHeader: boolean;
  chosenTier: string;
  chosenPrice: string;
  reasoning: string;
  chosenOutcome: string;
  chosenTx?: string;
  requestedTierAttempted: string;
  requestedOutcome: string;
  requestedTx?: string;
  requestedReason?: string;
};

async function main(): Promise<void> {
  const model = env["GEMINI_MODEL"] ?? "gemini-3.8-flash";
  const { header, delegation } = buildHeader();

  process.stdout.write(`S5: self-limiting agent on ${MONAD_TESTNET.name} (${MONAD_TESTNET.chainId})\n`);
  process.stdout.write(`model ${model}, temperature 0, ${RUNS} runs attempted\n`);
  process.stdout.write(`agent ${agent.address}\n\n`);

  // Read the authority once per run so each recorded decision is tied to the chain
  // state at the moment it was made.
  const records: RunRecord[] = [];
  const failures: string[] = [];

  for (let i = 1; i <= RUNS; i += 1) {
    let authority;
    try {
      authority = await getMyAuthority(publicClient, header as never, sellerConfig());
    } catch (error) {
      failures.push(`run ${i}: could not read my own authority: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const capDescription = [
      `  cap: ${authority.capBaseUnits} base units of ${authority.capToken}`,
      `  period: ${authority.periodSeconds} seconds`,
      `  expires: ${authority.expiry}`,
      `  a seller verifying this header allows it: ${authority.sellerAllowsHeader}`,
      `  and says: ${authority.sellerReason}`,
    ].join("\n");

    let reply: GeminiReply;
    try {
      reply = await askModel(capDescription);
    } catch (error) {
      failures.push(`run ${i}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const chosen = TIERS.find((t) => t.name === reply.tier)!;
    const requested = TIERS.find((t) => t.name === "expensive-dataset")!;

    process.stdout.write(`--- run ${i}\n`);
    process.stdout.write(`  cap the agent read   ${authority.capBaseUnits} of ${authority.capToken}\n`);
    process.stdout.write(`  agent chose          ${chosen.name} (${chosen.price})\n`);
    process.stdout.write(`  why                   ${reply.reasoning}\n`);

    // The unconditional half: whatever the model decided, the requested tier is
    // attempted so the record contains the on-chain refusal too.
    const requestedResult = await redeem(delegation, requested.price);
    process.stdout.write(`  ${requested.name} (${requested.price}) -> ${requestedResult.outcome}\n`);

    const chosenResult =
      chosen.name === requested.name ? requestedResult : await redeem(delegation, chosen.price);
    if (chosen.name !== requested.name) {
      process.stdout.write(`  ${chosen.name} (${chosen.price}) -> ${chosenResult.outcome}\n`);
    }

    records.push({
      run: i,
      model,
      temperature: 0,
      capReadByAgent: authority.capBaseUnits,
      capToken: authority.capToken,
      sellerAllowsHeader: authority.sellerAllowsHeader,
      chosenTier: chosen.name,
      chosenPrice: chosen.price.toString(),
      reasoning: reply.reasoning,
      chosenOutcome: chosenResult.outcome,
      ...(chosenResult.tx === undefined ? {} : { chosenTx: chosenResult.tx }),
      requestedTierAttempted: requested.name,
      requestedOutcome: requestedResult.outcome,
      ...(requestedResult.tx === undefined ? {} : { requestedTx: requestedResult.tx }),
      ...(requestedResult.reason === undefined ? {} : { requestedReason: requestedResult.reason }),
    });
  }

  const outPath = new URL("../../../working/s5-runs.json", import.meta.url);
  writeFileSafe(outPath, `${JSON.stringify({ model, temperature: 0, runs: records, failures }, null, 2)}\n`);

  process.stdout.write(`\n=== summary\n`);
  process.stdout.write(`  clean runs recorded  ${records.length} of ${RUNS}\n`);
  for (const f of failures) process.stdout.write(`  skipped: ${f}\n`);
  const downgraded = records.filter((r) => r.chosenTier === "cheap-dataset").length;
  process.stdout.write(`  chose the cheap tier  ${downgraded} of ${records.length}\n`);
  process.stdout.write(`  premium reverted      ${records.filter((r) => r.requestedOutcome !== "mined-success").length} of ${records.length}\n`);
  const wrote = records.length > 0 ? `working/s5-runs.json (${records.length} runs)` : "nothing -- no clean run to write";
  process.stdout.write(`\n  written: ${wrote}\n`);
}

/**
 * `working/` is untracked on purpose, so this never fails the run on a missing
 * directory or a read-only checkout.
 */
function writeFileSafe(url: URL, contents: string): void {
  try {
    // mkdirSync on a file path throws EISDIR rather than creating the parent. The
    // first version of this wrote to a path that did not exist and reported
    // success anyway, because the failure went to stderr and the summary below
    // still printed "written to working/s5-runs.json".
    mkdirSync(dirname(url.pathname), { recursive: true });
    writeFileSync(url, contents);
  } catch (error) {
    process.stderr.write(`could not write ${url.pathname}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});