import { describe, expect, it } from "vitest";
import {
  CHECK_ALL,
  CHECK_GRAPH,
  CHECK_IDENTITY,
  CHECK_MANIFEST,
  TERMS_LENGTH,
  TERMS_VERSION,
  ZERO_ADDRESS,
  ZERO_HASH,
  decodeTerms,
  describeChecks,
  encodeTerms,
  isRoot,
  TermsError,
} from "../src/terms.js";

const HASH = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const PARENT = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
const SELLER = "0x3333333333333333333333333333333333333333" as const;

describe("terms encoding", () => {
  /**
   * Five fields, so 160 bytes. Asserted rather than assumed: `abi.encode` pads
   * every field to a 32-byte word, including `uint8`, and a silent length change
   * reverts inside someone else's call instead of failing here.
   */
  it("is 160 bytes, not 66: abi.encode pads uint8 to a full word", () => {
    const terms = encodeTerms({ checks: CHECK_ALL, manifestHash: HASH });
    expect(TERMS_LENGTH).toBe(160);
    expect((terms.length - 2) / 2).toBe(160);
  });

  it("round-trips", () => {
    const terms = encodeTerms({
      checks: CHECK_MANIFEST | CHECK_GRAPH,
      manifestHash: HASH,
      parentDelegationHash: PARENT,
      allowedSeller: SELLER,
    });
    expect(decodeTerms(terms)).toEqual({
      version: TERMS_VERSION,
      checks: CHECK_MANIFEST | CHECK_GRAPH,
      manifestHash: HASH,
      parentDelegationHash: PARENT,
      allowedSeller: SELLER,
    });
  });

  it("defaults to a root delegation with zero parent", () => {
    const decoded = decodeTerms(encodeTerms({ checks: CHECK_IDENTITY }));
    expect(isRoot(decoded)).toBe(true);
    expect(decoded.parentDelegationHash).toBe(ZERO_HASH);
    expect(decoded.manifestHash).toBe(ZERO_HASH);
  });

  /**
   * An omitted seller is the zero address, which the contract reads as "any
   * seller". A delegation minted for general use has to stay usable everywhere.
   */
  it("defaults the seller to zero, meaning any seller", () => {
    expect(decodeTerms(encodeTerms({ checks: CHECK_IDENTITY })).allowedSeller).toBe(ZERO_ADDRESS);
    expect(ZERO_ADDRESS).toMatch(/^0x0{40}$/);
  });

  it("carries a named seller when one is given", () => {
    const decoded = decodeTerms(encodeTerms({ checks: CHECK_IDENTITY, allowedSeller: SELLER }));
    expect(decoded.allowedSeller).toBe(SELLER);
  });

  /**
   * A version we do not implement must be refused rather than encoded, because a
   * future field would be silently dropped and the delegation would permit less
   * than its author intended.
   */
  it("rejects an unsupported version, matching the contract", () => {
    expect(() => encodeTerms({ checks: CHECK_ALL, manifestHash: HASH, version: 3 })).toThrow(TermsError);
    expect(() => encodeTerms({ checks: CHECK_ALL, manifestHash: HASH, version: 1 })).toThrow(TermsError);
  });

  it("rejects unknown check bits", () => {
    expect(() => encodeTerms({ checks: 0b1000, manifestHash: HASH })).toThrow(TermsError);
  });

  it("rejects MANIFEST enabled with a zero manifestHash", () => {
    expect(() => encodeTerms({ checks: CHECK_MANIFEST })).toThrow(TermsError);
  });

  it("rejects a non-zero manifestHash while MANIFEST is off", () => {
    expect(() => encodeTerms({ checks: CHECK_GRAPH, manifestHash: HASH })).toThrow(TermsError);
  });

  it("rejects a malformed seller address rather than widening scope", () => {
    expect(() =>
      encodeTerms({ checks: CHECK_IDENTITY, allowedSeller: "0xnothex" as never }),
    ).toThrow(TermsError);
  });

  it("names the enabled checks", () => {
    expect(describeChecks(CHECK_ALL)).toEqual(["MANIFEST", "GRAPH", "IDENTITY"]);
    expect(describeChecks(CHECK_MANIFEST)).toEqual(["MANIFEST"]);
    expect(describeChecks(0)).toEqual([]);
  });
});
