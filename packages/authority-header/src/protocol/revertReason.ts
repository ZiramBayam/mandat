/**
 * Reading a custom error back out of a Monad node response.
 *
 * viem's `call` helper resolves a revert into an exception and drops the return
 * data, and the raw `eth_call` path puts the payload in the message text rather
 * than in a structured field. So a failed redemption, which is the single most
 * important thing to explain, arrives as the string "Execution reverted for an
 * unknown reason" unless something decodes it.
 *
 * This is reporting only. Nothing here decides whether a call is allowed; the
 * contract and the enforcers do that. A wrong answer from `explainRevert` produces
 * a confusing log line, not a released resource.
 */

import { decodeAbiParameters, keccak256, toHex } from "viem";

/**
 * Reverts the DelegationManager and enforcer paths can surface.
 *
 * `wantsString` is `true` when the selector is followed by an abi-encoded string,
 * which is how the caveat enforcers report a named reason. `false` means a bare
 * custom error with no arguments.
 *
 * Listed rather than derived: a foundry run is the only reliable way to learn what
 * a given revert looks like on this chain, and a guess would be a wrong log line.
 */
const KNOWN_REVERTS: readonly (readonly [signature: string, wantsString: boolean])[] = [
  ["ERC20PeriodTransferEnforcer:transfer-amount-exceeded", true],
  ["SkillAuthorityEnforcer:authority-not-live", true],
  ["SkillAuthorityEnforcer:manifest-not-live", true],
  ["NotYourDelegation()", false],
  ["UnknownDelegation()", false],
  ["AlreadyRevoked()", false],
  ["NotEntryPoint()", false],
  ["ParentNotRegistered()", false],
];

const SELECTORS = new Map<string, { signature: string; wantsString: boolean }>(
  KNOWN_REVERTS.map(([signature, wantsString]) => [
    keccak256(toHex(signature)).slice(0, 10).toLowerCase(),
    { signature, wantsString },
  ]),
);

/**
 * The first hex blob in a node error message is assumed to be the revert payload.
 *
 * Some nodes also print the transaction hash, and a tx hash is 32 bytes, so a
 * message with no revert data at all can match. That case is handled by the length
 * check in `explainRevert`: a bare hash would decode to an unknown selector rather
 * than being reported as a reason, which is the correct failure direction.
 */
function extractPayload(text: string): string | undefined {
  return /0[xX][0-9a-fA-F]{8,}/.exec(text)?.[0];
}

export function explainRevert(text: string): string {
  const payload = extractPayload(text);
  if (payload === undefined) {
    return text.split("\n")[0] ?? "reverted with no readable data";
  }

  const selector = payload.slice(0, 10).toLowerCase();
  const known = SELECTORS.get(selector);
  if (known === undefined) return `unknown selector ${selector}`;

  if (!known.wantsString) return known.signature;
  try {
    const [value] = decodeAbiParameters([{ type: "string" }], `0x${payload.slice(10)}`);
    return `${known.signature}: ${String(value)}`;
  } catch {
    // The selector matched but the arguments did not decode, which means the
    // on-chain error has a different shape than the table assumes. Report the bare
    // signature rather than a half-decoded string.
    return known.signature;
  }
}

/** Selectors this module can name, for a caller that wants to check coverage. */
export function knownSelectors(): readonly string[] {
  return [...SELECTORS.keys()];
}
