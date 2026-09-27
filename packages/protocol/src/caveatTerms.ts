/**
 * DTK caveat `terms` are NOT abi.encode. Each built-in enforcer decodes a bespoke
 * packed layout, and several require an exact byte length. Read off the enforcer
 * sources in lib/delegation-framework/src/enforcers, not inferred.
 *
 *   AllowedTargets          n * 20   packed addresses, must be non-empty
 *   AllowedMethods          n * 4    packed selectors, must be non-empty
 *   ERC20PeriodTransfer     116      address(20) amount(32) duration(32) startDate(32)
 *   Timestamp                32      uint128 afterThreshold, uint128 beforeThreshold
 *   LimitedCalls             32      uint256 limit
 *
 * Getting this wrong is silent: the enforcer reverts on a length check and a demo
 * built on a wrong guess fails at redemption rather than at compile time. Every
 * encoder here is asserted against the LIVE enforcer's own getTermsInfo() in
 * contracts/test/CompiledEnvelope.t.sol.
 */

import { concat, encodePacked, pad, toHex, type Address, type Hex } from "viem";
import { ManifestError } from "./period.js";

function strip(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

export function encodeAllowedTargets(targets: readonly Address[]): Hex {
  if (targets.length === 0) {
    throw new ManifestError("AllowedTargets terms must be non-empty; an envelope with no target bound is not an envelope");
  }
  for (const t of targets) {
    if (strip(t).length !== 40) throw new ManifestError(`target ${t} is not 20 bytes`);
  }
  return concat(targets.map((t) => t.toLowerCase() as Hex));
}

export function encodeAllowedMethods(selectors: readonly Hex[]): Hex {
  if (selectors.length === 0) throw new ManifestError("AllowedMethods terms must be non-empty");
  for (const s of selectors) {
    if (strip(s).length !== 8) throw new ManifestError(`selector ${s} is not 4 bytes`);
  }
  return concat(selectors.map((s) => s.toLowerCase() as Hex));
}

/**
 * 116 bytes, packed. Note this is NOT abi.encode(address, uint256, uint256, uint256),
 * which would be 128 bytes with the address padded to a full word.
 */
export function encodeERC20PeriodTransfer(params: {
  token: Address;
  periodAmount: bigint;
  periodDuration: bigint;
  startDate: bigint;
}): Hex {
  if (params.periodAmount === 0n) throw new ManifestError("periodAmount must be non-zero");
  if (params.periodDuration === 0n) throw new ManifestError("periodDuration must be non-zero");
  // The enforcer reverts on a zero startDate and on a startDate in the future.
  if (params.startDate === 0n) throw new ManifestError("startDate must be non-zero; the enforcer rejects zero");
  const out = concat([
    params.token.toLowerCase() as Hex,
    pad(toHex(params.periodAmount), { size: 32 }),
    pad(toHex(params.periodDuration), { size: 32 }),
    pad(toHex(params.startDate), { size: 32 }),
  ]);
  if (strip(out).length !== 232) throw new ManifestError(`ERC20PeriodTransfer terms must be 116 bytes, got ${strip(out).length / 2}`);
  return out;
}

/**
 * 32 bytes: first 16 are the "must be after" threshold, last 16 the "must be before".
 * A zero on either side disables that bound, which is how an open-ended delegation
 * is expressed. We always set an expiry, so `before` is never left at zero.
 */
export function encodeTimestamp(params: { afterThreshold?: bigint; beforeThreshold: bigint }): Hex {
  if (params.beforeThreshold <= 0n) throw new ManifestError("beforeThreshold must be non-zero; an open-ended delegation is not one we compile");
  if (params.afterThreshold !== undefined && params.afterThreshold > 0xffffffffffffffffn) {
    throw new ManifestError("afterThreshold does not fit in uint128");
  }
  if (params.beforeThreshold > 0xffffffffffffffffn) {
    throw new ManifestError("beforeThreshold does not fit in uint128");
  }
  // dir:"left" zero-pads on the left, so the value is right-aligned in its 16 bytes.
  // dir:"right" would left-align it and the enforcer would read a shifted number.
  return concat([
    pad(toHex(params.afterThreshold ?? 0n), { dir: "left", size: 16 }),
    pad(toHex(params.beforeThreshold), { dir: "left", size: 16 }),
  ]);
}

export function encodeLimitedCalls(limit: bigint): Hex {
  if (limit <= 0n) throw new ManifestError("limit must be positive");
  return pad(toHex(limit), { size: 32 });
}
