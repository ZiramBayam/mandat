#!/usr/bin/env node
/**
 * envelope -- compile a SKILL.md permissions block into DTK caveats.
 *
 *   envelope inspect  <SKILL.md>   parsed permissions, human readable
 *   envelope compile  <SKILL.md>   caveats + terms, written as JSON
 *
 * Neither command signs or broadcasts. Signing is the user's decision and happens
 * in their wallet, never in this process.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { ManifestError, parsePermissions, type Permissions } from "./manifest.js";
import { compileEnvelope, serialiseForChainTest, type EnforcerAddresses } from "./compile.js";

function frontmatterOf(markdown: string): string {
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (match?.[1] === undefined) throw new ManifestError("no YAML frontmatter found");
  return match[1];
}

/**
 * Enforcer addresses. The three DTK builtins are live at these addresses on both
 * Monad chains; Timestamp and LimitedCalls are deployed by
 * contracts/script/DeployCaveatEnforcers.s.sol, because DTK's CREATE2 salt is not
 * published and the address cannot be derived. Parity with the live builtins is
 * asserted in contracts/test/CaveatEnforcerParity.t.sol.
 */
function enforcersFromEnv(): EnforcerAddresses {
  const required = (name: string): Address => {
    const v = process.env[name];
    if (v === undefined || !v.startsWith("0x")) {
      throw new ManifestError(`${name} is not set. Copy contracts/.env.example to contracts/.env and fill it in.`);
    }
    return v as Address;
  };
  return {
    allowedTargets: required("ENFORCER_ALLOWED_TARGETS"),
    allowedMethods: required("ENFORCER_ALLOWED_METHODS"),
    erc20PeriodTransfer: required("ENFORCER_ERC20_PERIOD"),
    timestamp: required("ENFORCER_TIMESTAMP"),
    limitedCalls: required("ENFORCER_LIMITED_CALLS"),
    skillAuthority: required("SKILL_AUTHORITY_ENFORCER"),
  };
}

function main(argv: string[]): number {
  const [command, path, outPath] = argv;
  if (command === undefined || path === undefined) {
    process.stderr.write("usage: envelope <inspect|compile> <SKILL.md> [out.json]\n");
    return 2;
  }

  const markdown = readFileSync(path, "utf8");
  const permissions: Permissions = parsePermissions(frontmatterOf(markdown));

  if (command === "inspect") {
    process.stdout.write(`${JSON.stringify(permissions, null, 2)}\n`);
    return 0;
  }
  if (command !== "compile") {
    process.stderr.write(`unknown command "${command}"\n`);
    return 2;
  }

  // The manifest digest commits to these exact bytes, so the on-chain envelope can
  // be tied back to a document a human read and approved.
  // Commits to these exact bytes, so the on-chain envelope can be tied back to a
  // document a human read. Content-addressed: the CID is derived from the same bytes.
  const manifestHash = keccak256(toHex(markdown)) as Hex;
  const now = process.env["ENVELOPE_NOW"];
  const compiled = compileEnvelope({
    permissions,
    manifestHash,
    enforcers: enforcersFromEnv(),
    ...(now === undefined ? {} : { now: Number(now) }),
  });

  const json = serialiseForChainTest(compiled);
  if (outPath !== undefined) {
    writeFileSync(outPath, json);
    process.stderr.write(`manifestHash ${manifestHash}\nwrote ${outPath}\n`);
  } else {
    process.stdout.write(`${json}\n`);
  }
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
