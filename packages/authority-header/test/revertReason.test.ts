import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, toHex } from "viem";
import { explainRevert, knownSelectors } from "../src/protocol/revertReason.js";

/**
 * Revert explanation is what turns "the transfer failed" into "the cap was
 * exceeded by 0.3 WMON". The G6 and G9 evidence quotes that string, so a parsing
 * regression here silently weakens the strongest claim in the project.
 */
describe("explainRevert", () => {
  it("names a custom error that carries no arguments", () => {
    const selector = keccak256(toHex("NotYourDelegation()")).slice(0, 10);
    expect(explainRevert(`execution reverted: ${selector}`)).toBe("NotYourDelegation()");
  });

  it("names a caveat enforcer error and its string argument", () => {
    const signature = "ERC20PeriodTransferEnforcer:transfer-amount-exceeded";
    const selector = keccak256(toHex(signature)).slice(0, 10);
    const args = encodeAbiParameters([{ type: "string" }], ["Transfer amount exceeded"]);
    expect(explainRevert(`execution reverted: ${selector}${args.slice(2)}`)).toBe(
      `${signature}: Transfer amount exceeded`,
    );
  });

  it("reports the bare signature when a string error's arguments do not decode", () => {
    // Selector is right, tail is not abi-encoded. Reporting a half-decoded string
    // would be worse than reporting nothing.
    const selector = keccak256(toHex("ERC20PeriodTransferEnforcer:transfer-amount-exceeded")).slice(0, 10);
    expect(explainRevert(`execution reverted: ${selector}deadbeef`)).toBe(
      "ERC20PeriodTransferEnforcer:transfer-amount-exceeded",
    );
  });

  it("says the selector is unknown rather than guessing at a reason", () => {
    const selector = keccak256(toHex("SomethingNobodyListed()")).slice(0, 10);
    expect(explainRevert(`execution reverted: ${selector}`)).toBe(`unknown selector ${selector}`);
  });

  it("handles the exact string viem produces when it has no data", () => {
    expect(explainRevert("Execution reverted for an unknown reason.\nDocs: https://viem.sh")).toBe(
      "Execution reverted for an unknown reason.",
    );
  });

  it("is case-insensitive about the payload", () => {
    const selector = keccak256(toHex("NotEntryPoint()")).slice(0, 10);
    expect(explainRevert(`execution reverted: ${selector.toUpperCase()}`)).toBe("NotEntryPoint()");
  });

  it("exposes its selectors so a coverage gap is visible", () => {
    const selectors = knownSelectors();
    for (const required of [
      keccak256(toHex("ERC20PeriodTransferEnforcer:transfer-amount-exceeded")).slice(0, 10).toLowerCase(),
      keccak256(toHex("NotYourDelegation()")).slice(0, 10).toLowerCase(),
    ]) {
      expect(selectors).toContain(required);
    }
  });
});
