import type { Tier } from "../protocol/verify.js";

/**
 * Two tiers so the demo has a decision to make. The expensive one is priced
 * above the envelope cap on purpose: that is the case where a non-payment
 * decision actually matters, because producing the resource first and refusing
 * at settlement would waste it.
 */
export const DEMO_TIERS: readonly Tier[] = [
  { name: "cheap-dataset", priceUsdc: 0.005 },
  { name: "expensive-dataset", priceUsdc: 80 },
];
