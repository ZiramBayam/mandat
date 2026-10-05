import type { Address } from "viem";
import type { Tier } from "../protocol/verify.js";

/**
 * Two tiers so the demo has a decision to make. The expensive one is priced above
 * the envelope cap on purpose: that is the case where a non-payment decision
 * actually matters, because producing the resource first and refusing at
 * settlement would waste it.
 *
 * Prices are in base units of the skill's own token, and the token is named.
 *
 * Both because a cap is meaningless without its token, and because a number
 * without a unit is how a 0.5-token budget ends up looking larger than an
 * 80-dollar price: 5e17 base units dwarfs 8e7 by twelve orders of magnitude, and
 * a seller that compared them without checking would sell the expensive tier
 * against a budget that cannot cover it. That is not hypothetical; it is what the
 * seller did before `Tier` carried a token.
 *
 * `CAP_TOKEN` in contracts/.env must match the token the envelope caps. The seller
 * refuses rather than converts, because without a price oracle any conversion it
 * did would be a guess, and a guess in this direction is an over-sale.
 */
const CAP_TOKEN = (process.env["CAP_TOKEN"] ?? "0x0000000000000000000000000000000000000000") as Address;

/** Half a token, matching the fixture's cap. */
const CHEAP = 100_000_000_000_000_000n; // 0.1
/** Above the 0.5 cap, so this is the tier the seller must refuse. */
const EXPENSIVE = 800_000_000_000_000_000n; // 0.8

export const DEMO_TIERS: readonly Tier[] = [
  { name: "cheap-dataset", price: CHEAP, token: CAP_TOKEN },
  { name: "expensive-dataset", price: EXPENSIVE, token: CAP_TOKEN },
];
