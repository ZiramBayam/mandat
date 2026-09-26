import { describe, expect, it } from "vitest";
import {
  CHECK_ALL,
  CHECK_GRAPH,
  CHECK_IDENTITY,
  CHECK_MANIFEST,
  TERMS_LENGTH,
  ZERO_HASH,
  decodeTerms,
  describeChecks,
  encodeTerms,
  isRoot,
  TermsError,
} from "../src/terms.js";

const HASH = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const PARENT = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

describe("terms encoding", () => {
  it("is 128 bytes, not 66: abi.encode pads uint8 to a full word", () => {
    const terms = encodeTerms({ checks: CHECK_ALL, manifestHash: HASH });
    expect(TERMS_LENGTH).toBe(128);
    expect((terms.length - 2) / 2).toBe(128);
  });

  it("round-trips", () => {
    const terms = encodeTerms({ checks: CHECK_MANIFEST | CHECK_GRAPH, manifestHash: HASH, parentDelegationHash: PARENT });
    expect(decodeTerms(terms)).toEqual({
      version: 1,
      checks: CHECK_MANIFEST | CHECK_GRAPH,
      manifestHash: HASH,
      parentDelegationHash: PARENT,
    });
  });

  it("defaults to a root delegation with zero parent", () => {
    const decoded = decodeTerms(encodeTerms({ checks: CHECK_IDENTITY }));
    expect(isRoot(decoded)).toBe(true);
    expect(decoded.parentDelegationHash).toBe(ZERO_HASH);
    expect(decoded.manifestHash).toBe(ZERO_HASH);
  });

  it("rejects an unsupported version, matching the contract", () => {
    expect(() => encodeTerms({ checks: CHECK_ALL, manifestHash: HASH, version: 2 })).toThrow(TermsError);
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

  it("names the enabled checks", () => {
    expect(describeChecks(CHECK_ALL)).toEqual(["MANIFEST", "GRAPH", "IDENTITY"]);
    expect(describeChecks(CHECK_MANIFEST)).toEqual(["MANIFEST"]);
    expect(describeChecks(0)).toEqual([]);
  });
});
