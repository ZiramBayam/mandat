import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ManifestError, parsePermissions, periodToSeconds, validatePermissions, type Permissions } from "../src/manifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "../../../contracts/fixtures/wmon-spend/SKILL.md");

function frontmatterOf(markdown: string): string {
  const m = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (m?.[1] === undefined) throw new ManifestError("no frontmatter");
  return m[1];
}

describe("the shipped fixture", () => {
  const permissions = parsePermissions(frontmatterOf(readFileSync(fixturePath, "utf8")));

  it("parses chains as plain CAIP-2 strings, not objects", () => {
    expect(permissions.chains).toEqual(["eip155:10143"]);
  });

  it("parses a list item that is a map, not a flattened string", () => {
    expect(permissions.contracts).toHaveLength(1);
    expect(permissions.contracts[0]?.address).toBe("0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541");
    expect(permissions.contracts[0]?.methods).toEqual(["0xa9059cbb"]);
  });

  it("keeps base-unit amounts as strings so precision survives", () => {
    const t = permissions.tokens[0];
    expect(typeof t?.perPeriod).toBe("string");
    // Above 2^53, so Number() would round it and the compiled cap would not be
    // the cap the manifest asked for.
    expect(BigInt(t!.perPeriod)).toBe(500000000000000000n);
  });

  it("parses tokens, expiry and maxCalls", () => {
    expect(permissions.tokens[0]?.symbol).toBe("WMON");
    expect(permissions.tokens[0]?.period).toBe("24h");
    expect(permissions.expiry).toBe("7d");
    expect(permissions.maxCalls).toBe("20");
  });
});

describe("periodToSeconds", () => {
  it("converts each unit", () => {
    expect(periodToSeconds("30s")).toBe(30);
    expect(periodToSeconds("5m")).toBe(300);
    expect(periodToSeconds("24h")).toBe(86400);
    expect(periodToSeconds("7d")).toBe(604800);
    expect(periodToSeconds("1w")).toBe(604800);
  });

  it("rejects nonsense", () => {
    expect(() => periodToSeconds("7 days")).toThrow(ManifestError);
    expect(() => periodToSeconds("")).toThrow(ManifestError);
  });
});

describe("validation is fail-closed", () => {
  const base: Permissions = {
    chains: ["eip155:10143"],
    contracts: [{ address: "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541", methods: ["0xa9059cbb"] }],
    tokens: [{ symbol: "WMON", address: "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541", perPeriod: "1", period: "24h" }],
    expiry: "7d",
  };

  it("rejects a bare chain id", () => {
    expect(() => validatePermissions({ ...base, chains: ["10143"] })).toThrow(ManifestError);
  });

  it("rejects a malformed address", () => {
    expect(() =>
      validatePermissions({ ...base, contracts: [{ address: "0xdeadbeef" as `0x${string}`, methods: ["0xa9059cbb"] }] }),
    ).toThrow(ManifestError);
  });

  it("rejects a function name where a selector belongs", () => {
    expect(() =>
      validatePermissions({
        ...base,
        contracts: [{ address: base.contracts[0]!.address, methods: ["transfer" as `0x${string}`] }],
      }),
    ).toThrow(ManifestError);
  });

  it("rejects an empty target list, which would be no envelope at all", () => {
    expect(() => validatePermissions({ ...base, contracts: [] })).toThrow(ManifestError);
  });

  it("rejects an empty method list", () => {
    expect(() =>
      validatePermissions({ ...base, contracts: [{ address: base.contracts[0]!.address, methods: [] }] }),
    ).toThrow(ManifestError);
  });

  it("rejects a float in perPeriod", () => {
    expect(() =>
      validatePermissions({ ...base, tokens: [{ ...base.tokens[0]!, perPeriod: "0.5" }] }),
    ).toThrow(ManifestError);
  });
});
