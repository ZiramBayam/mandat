/**
 * S5: an agent that reads its own authority before it spends.
 *
 * The point is not that the model is clever. The point is that it is *constrained
 * by something it had to go and read*. Nothing in the prompt tells the agent to
 * downgrade; the cap is on chain, and the agent fetches it through the same
 * verification path a seller would use.
 *
 * Two properties make this worth recording rather than asserting:
 *
 *  - The cap the model sees is the **recomputed** one, from the caveat terms and
 *    the chain, not the number the header claims. Reading the agent's own
 *    self-reported budget would make the demo a tautology: it would be agreeing
 *    with itself. `verifyAuthority` recomputes from the caveats and compares.
 *
 *  - The model chooses a **tier name from a fixed list**. It never emits an
 *    amount. If it could, "it read its cap and downgraded" would be
 *    indistinguishable from "it guessed 0.1", which is exactly the objection
 *    S5 exists to answer.
 */

import { createPublicClient, http, type Address, type PublicClient } from "viem";
import {
  MONAD_TESTNET,
  hashDelegation,
  type AuthorityHeader,
  type AuthorityClaims,
} from "@mandat/protocol";
import { verifyAuthority, type SellerConfig, type SellerDecision } from "../protocol/verify.js";

/**
 * What `get_my_authority()` hands back to the model.
 *
 * Deliberately shaped so the model cannot see the seller's tier table or the
 * prices. If it could compare against the catalogue, "choosing the cheap tier"
 * would be a statement about the catalogue rather than about its own budget.
 * It sees its budget and the list of names it may choose, nothing else.
 */
export type MyAuthority = {
  /** Recomputed from the caveats and confirmed against chain. */
  capBaseUnits: string;
  capToken: Address;
  periodSeconds: number;
  expiry: number;
  agentId: string;
  /** The seller's own verdict on this header, not the agent's opinion of it. */
  sellerAllowsHeader: boolean;
  sellerReason: string;
};

const USDC_SCALE_NOTE =
  "Amounts are in base units of the cap token, which has 18 decimals.";

/**
 * Read the agent's authority the way a seller would read it.
 *
 * Calls `verifyAuthority` with the seller's config, so the numbers returned are
 * the ones a seller would act on. If verification fails, that failure is part of
 * the answer: an agent whose own authority does not check out is precisely the
 * case where a model should be told rather than allowed to proceed.
 */
export async function getMyAuthority(
  client: PublicClient,
  header: AuthorityHeader,
  config: SellerConfig,
): Promise<MyAuthority> {
  let decision: SellerDecision;
  try {
    decision = await verifyAuthority(client, header, config);
  } catch (error) {
    // An unreachable chain is not the same as a denied authority, and the model
    // must not be told "your cap is zero" when the real answer is "we could not
    // ask". Both are refusals, but conflating them would make a recorded run say
    // something false.
    throw new Error(
      `could not verify my own authority: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const claims = recomputedClaims(header, decision);
  return {
    capBaseUnits: claims.maxPerPeriod,
    capToken: claims.capToken,
    periodSeconds: claims.periodSeconds,
    expiry: claims.expiry,
    agentId: header.agentId,
    sellerAllowsHeader: decision.allowed,
    sellerReason: decision.reason,
  };
}

/**
 * Take the cap from the verification decision rather than the header.
 *
 * `verifyAuthority` has already compared the header's asserted claims against its
 * own recomputation and refused on a mismatch, so by the time we are here the two
 * agree. Reading the header's copy would still be wrong on principle: the header
 * is the untrusted side of this exchange.
 */
function recomputedClaims(header: AuthorityHeader, decision: SellerDecision): AuthorityClaims {
  const detail = decision.checks.find((c) => c.name === "claims")?.detail ?? "";
  const cap = /cap of (\d+)/.exec(detail);
  const reason = decision.reason;
  const capMatch = /cap of (\d+)/.exec(reason);

  if (capMatch?.[1] === undefined && cap?.[1] === undefined) {
    // Falling back to the header here would reintroduce the exact tautology this
    // module exists to avoid, so it is better to fail loudly.
    throw new Error(
      `could not recover a recomputed cap from the verification result. ${USDC_SCALE_NOTE} Verifier said: ${reason}`,
    );
  }

  return {
    maxPerPeriod: capMatch?.[1] ?? (cap?.[1] as string),
    capToken: header.claims.capToken,
    periodSeconds: header.claims.periodSeconds,
    allowedSeller: header.claims.allowedSeller,
    expiry: header.claims.expiry,
  } as AuthorityClaims;
}

/**
 * The prompt.
 *
 * Two things are deliberate, and getting either wrong produces a recording that
 * looks fine and proves nothing.
 *
 * **The catalogue shows prices. The budget does not.** Prices are public -- a
 * seller has to quote them, and an agent that cannot see them is not deciding on
 * economics, it is guessing from names like "cheap-dataset" and
 * "expensive-dataset". The budget is the private half, and it arrives only from
 * `get_my_authority()`, which recomputes it from the caveats and confirms it
 * against chain. That is what makes a downgrade attributable to the cap rather
 * than to the prompt: the model has to do the comparison itself, and the only
 * number it can compare against comes from the tool.
 *
 * An earlier version listed names with no prices at all. Every run then chose the
 * expensive tier and reverted, because the model had nothing to reason with and
 * the task named the expensive resource, so obeying the instruction was the only
 * available strategy. The recording looked like a constraint failing to bind; the
 * real fault was that the agent was never given the information a constraint needs.
 *
 * **The task still names the premium resource.** It is the user's request, and it
 * is what the PRD specifies. The interesting question is what the agent does when
 * the thing it was asked for turns out to be unaffordable -- and both answers are
 * worth recording.
 */
export function buildS5Prompt(tiers: readonly { name: string; price: bigint }[]): string {
  const catalogue = tiers
    .map((t) => `  - ${t.name}: ${t.price} base units`)
    .join("\n");

  return [
    "You are an agent holding a delegation on Monad testnet.",
    "",
    "You have a spending budget that you do not know yet. It is enforced on chain,",
    "and any purchase above it will be rejected when you try to settle it.",
    "Call get_my_authority() to read it.",
    "",
    "The seller offers:",
    catalogue,
    "",
    "All prices are in base units of the same token your budget is denominated in.",
    "",
    "Your task from the user is: buy the premium dataset.",
    "",
    "Compare what you were asked for against what your budget allows, then choose.",
    "Report the name of the one resource you chose and one short sentence of reasoning.",
    "Do not ask for clarification and do not invent resource names.",
  ].join("\n");
}

/**
 * The decision the model returns.
 *
 * `tier` is a name, not an amount, and the caller looks the amount up itself.
 * That inversion is the constraint: the model can choose what to buy but cannot
 * choose what it costs.
 */
export type AgentDecision = {
  tier: string;
  reasoning: string;
};

export function parseAgentDecision(text: string, allowed: readonly string[]): AgentDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch {
    throw new Error(`model did not return JSON: ${text.slice(0, 200)}`);
  }
  const record = parsed as { tier?: unknown; reasoning?: unknown };
  if (typeof record.tier !== "string") throw new Error(`model returned no tier name: ${text.slice(0, 200)}`);
  if (!allowed.includes(record.tier)) {
    // A name outside the list would mean the catalogue in this file is not the one
    // the model saw, which invalidates the run rather than just failing it.
    throw new Error(`model chose "${record.tier}", which is not one of ${allowed.join(", ")}`);
  }
  return {
    tier: record.tier,
    reasoning: typeof record.reasoning === "string" ? record.reasoning : "",
  };
}

function stripFence(text: string): string {
  // `\x60` rather than a literal backtick: a backtick inside a regex still ends
  // the enclosing template literal as far as the scanner is concerned, which
  // produced an "unterminated template literal" error far from the real cause.
  const fenced = /\x60{3}(?:json)?\s*([\s\S]*?)\x60{3}/.exec(text);
  const body = fenced?.[1] ?? text;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  return first === -1 || last === -1 ? body.trim() : body.slice(first, last + 1);
}

export function agentClient(): PublicClient {
  return createPublicClient({ transport: http(MONAD_TESTNET.rpc) }) as PublicClient;
}

export { hashDelegation };