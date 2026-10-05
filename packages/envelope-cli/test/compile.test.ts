import { describe, expect, it } from "vitest";
import { compileEnvelope, serialiseForChainTest, type EnforcerAddresses } from "../src/compile.js";
import { ManifestError } from "../src/manifest.js";
import { ZERO_ADDRESS, decodeTerms } from "@mandat/protocol";
import type { Permissions } from "../src/manifest.js";
import type { Address } from "viem";

const ENFORCERS: EnforcerAddresses = {
  allowedTargets: "0x1111111111111111111111111111111111111111",
  allowedMethods: "0x2222222222222222222222222222222222222222",
  erc20PeriodTransfer: "0x3333333333333333333333333333333333333333",
  timestamp: "0x4444444444444444444444444444444444444444",
  limitedCalls: "0x5555555555555555555555555555555555555555",
  skillAuthority: "0x6666666666666666666666666666666666666666",
};

const MANIFEST_HASH = "0xeb4c4e0291f09b5342f66d21de289c8c27b8923d9932e7a00fcc88a921831cf6";

const BASE: Permissions = {
  chains: ["eip155:10143"],
  contracts: [{ address: "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541", methods: ["0xa9059cbb"] }],
  tokens: [
    {
      symbol: "WMON",
      address: "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541",
      perPeriod: "500000000000000000",
      period: "24h",
    },
  ],
  expiry: "7d",
  maxCalls: "20",
};

const NOW = 1_780_000_000;

/** `exactOptionalPropertyTypes` means an absent key, not an explicit undefined. */
function withoutMaxCalls(): Permissions {
  const { maxCalls: _omitted, ...rest } = BASE;
  return rest;
}

function compile(overrides: Partial<Parameters<typeof compileEnvelope>[0]> = {}) {
  return compileEnvelope({
    permissions: BASE,
    manifestHash: MANIFEST_HASH,
    enforcers: ENFORCERS,
    now: NOW,
    ...overrides,
  });
}

describe("compileEnvelope", () => {
  it("emits one caveat per declared permission plus the Mandat terms", () => {
    const out = compile();
    // targets, methods, one token, timestamp, limitedCalls, skillAuthority
    expect(out.caveats).toHaveLength(6);
    expect(out.caveats.map((c) => c.enforcer.toLowerCase())).toEqual([
      ENFORCERS.allowedTargets.toLowerCase(),
      ENFORCERS.allowedMethods.toLowerCase(),
      ENFORCERS.erc20PeriodTransfer.toLowerCase(),
      ENFORCERS.timestamp.toLowerCase(),
      ENFORCERS.limitedCalls.toLowerCase(),
      ENFORCERS.skillAuthority.toLowerCase(),
    ]);
  });

  /**
   * `limitedCalls` is the only conditional caveat, so a manifest without
   * `maxCalls` produces five caveats instead of six. Anything that reads
   * caveats by index is then off by one from that point on.
   */
  it("omits the limitedCalls caveat entirely when maxCalls is absent", () => {
    const out = compile({ permissions: withoutMaxCalls() });
    expect(out.caveats).toHaveLength(5);
    expect(out.caveats.map((c) => c.enforcer.toLowerCase())).not.toContain(
      ENFORCERS.limitedCalls.toLowerCase(),
    );
    expect(out.summary.maxCalls).toBeNull();
  });

  it("encodes terms as 160 bytes for our own enforcer", () => {
    const out = compile();
    expect(out.terms.length).toBe(2 + 2 * 160);
    expect(out.caveats.at(-1)?.terms).toBe(out.terms);
  });

  it("carries the seller scope into the terms, so it is readable off chain", () => {
    const seller = "0x4444444444444444444444444444444444444444" as const;
    const out = compile({ allowedSeller: seller });
    expect(out.summary.allowedSeller).toBe(seller);
    expect(decodeTerms(out.terms).allowedSeller).toBe(seller);
  });

  it("leaves the seller unscoped by default, so a general delegation stays usable", () => {
    expect(compile().summary.allowedSeller).toBe(ZERO_ADDRESS);
    expect(decodeTerms(compile().terms).allowedSeller).toBe(ZERO_ADDRESS);
  });

  it("computes the expiry from now, not from wall-clock time", () => {
    const out = compile();
    // 7d = 604800 seconds.
    expect(out.summary.notAfter).toBe(NOW + 604_800);
    expect(out.summary.notBefore).toBe(0);
  });

  it("refuses a permission block with no chains", () => {
    expect(() => compile({ permissions: { ...BASE, chains: [] } })).toThrow(ManifestError);
  });

  it("refuses a bare chain id, because cross-chain mistakes are expensive", () => {
    expect(() => compile({ permissions: { ...BASE, chains: ["10143"] as never } })).toThrow(ManifestError);
  });
});

describe("serialiseForChainTest", () => {
  /**
   * This is the regression the positional version had. With five caveats,
   * index 4 is the skillAuthority entry, so `limitedCalls` would have been
   * written as the skillAuthority terms and the Solidity test would have
   * decoded the wrong bytes under the wrong key without failing.
   */
  it("keys each enforcer by address, so a missing caveat shifts nothing", () => {
    const full = JSON.parse(serialiseForChainTest(compile(), ENFORCERS)) as {
      enforcers: Record<string, string>;
      caveatCount: number;
    };
    expect(full.caveatCount).toBe(6);
    expect(full.enforcers.limitedCalls).toBe(
      compile().caveats.find((c) => c.enforcer === ENFORCERS.limitedCalls)?.terms,
    );
    expect(full.enforcers.skillAuthority).toBe(compile().terms);

    const shifted = JSON.parse(
      serialiseForChainTest(compile({ permissions: withoutMaxCalls() }), ENFORCERS),
    ) as { enforcers: Record<string, string>; caveatCount: number };

    expect(shifted.caveatCount).toBe(5);
    // Absent, and explicitly empty rather than holding a neighbour's terms.
    expect(shifted.enforcers.limitedCalls).toBe("0x");
    // Present and still correct after the shift.
    expect(shifted.enforcers.skillAuthority).toBe(compile().terms);
    expect(shifted.enforcers.timestamp).toBe(
      compile().caveats.find((c) => c.enforcer === ENFORCERS.timestamp)?.terms,
    );
  });

  it("matches the address case-insensitively", () => {
    const mixedCase: EnforcerAddresses = {
      ...ENFORCERS,
      limitedCalls: `0x${ENFORCERS.limitedCalls.slice(2).toUpperCase()}` as Address,
    };
    const out = JSON.parse(serialiseForChainTest(compile(), mixedCase)) as {
      enforcers: Record<string, string>;
    };
    expect(out.enforcers.limitedCalls).not.toBe("0x");
  });
});
