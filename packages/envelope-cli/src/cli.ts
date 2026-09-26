#!/usr/bin/env node
/**
 * envelope -- compile a SKILL.md permissions block into a DTK delegation.
 *
 * Usage:
 *   envelope inspect <SKILL.md>     show the parsed permissions
 *   envelope compile <SKILL.md>     build caveats + terms, print the summary
 *
 * Neither command signs or broadcasts. Signing is the user's decision and
 * happens in their wallet, never in this process.
 */

import { readFileSync } from "node:fs";
import { parsePermissions, ManifestError, type Permissions } from "./manifest.js";
import { compileEnvelope } from "./compile.js";

function frontmatterOf(markdown: string): string {
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (match?.[1] === undefined) throw new ManifestError("no YAML frontmatter found");
  return match[1];
}

function main(argv: string[]): number {
  const [command, path] = argv;
  if (command === undefined || path === undefined) {
    process.stderr.write("usage: envelope <inspect|compile> <SKILL.md>\n");
    return 2;
  }
  const permissions: Permissions = parsePermissions(frontmatterOf(readFileSync(path, "utf8")));

  if (command === "inspect") {
    process.stdout.write(`${JSON.stringify(permissions, null, 2)}\n`);
    return 0;
  }
  if (command === "compile") {
    const compiled = compileEnvelope({
      permissions,
      manifestHash: `0x${"0".repeat(64)}`,
      delegate: "0x0000000000000000000000000000000000000000",
      delegator: "0x0000000000000000000000000000000000000000",
      salt: 0n,
    });
    process.stdout.write(`${JSON.stringify(compiled.summary, null, 2)}\n`);
    return 0;
  }
  process.stderr.write(`unknown command "${command}"\n`);
  return 2;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
