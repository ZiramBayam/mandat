import { ManifestError, periodToSeconds, type Period } from "@mandat/protocol";

export { ManifestError, periodToSeconds };
export type { Period };

/**
 * The `permissions` block we propose for the Agent Hub skill catalogue.
 *
 * This is a proposal, not something Monad has adopted. The format is what makes
 * a skill's intent machine-readable, so an envelope can be compiled from it
 * instead of guessed. See working/architecture.md 4 for the field semantics.
 *
 * The parser is strict on purpose. A skill that declares vague permissions
 * should fail to compile rather than silently get a wider envelope than intended.
 */



export type ContractPermission = {
  address: `0x${string}`;
  /** 4-byte selectors, not function names. Names change, selectors do not. */
  methods: `0x${string}`[];
};

export type TokenPermission = {
  symbol: string;
  address: `0x${string}`;
  /** Base units, decimal string. Never a JS number: 50 USDC is 50000000n. */
  perPeriod: string;
  period: Period;
};

export type Permissions = {
  /** CAIP-2. A bare chainId is a bug: cross-chain mistakes are the expensive kind. */
  chains: string[];
  contracts: ContractPermission[];
  tokens: TokenPermission[];
  expiry: Period;
  maxCalls?: string;
};

const SELECTOR = /^0x[0-9a-fA-F]{8}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CAIP2 = /^eip155:[0-9]+$/;

export function validatePermissions(p: Permissions): void {
  if (p.chains.length === 0) throw new ManifestError("permissions.chains is empty");
  for (const chain of p.chains) {
    if (!CAIP2.test(chain)) {
      throw new ManifestError(`"${chain}" is not a CAIP-2 id, expected eip155:<chainId>`);
    }
  }
  if (p.contracts.length === 0) {
    throw new ManifestError("permissions.contracts is empty; an envelope with no target bound is not an envelope");
  }
  for (const c of p.contracts) {
    if (!ADDRESS.test(c.address)) throw new ManifestError(`contract address "${c.address}" is malformed`);
    if (c.methods.length === 0) throw new ManifestError(`no methods listed for ${c.address}`);
    for (const m of c.methods) {
      if (!SELECTOR.test(m)) throw new ManifestError(`"${m}" is not a 4-byte selector`);
    }
  }
  for (const t of p.tokens) {
    if (!ADDRESS.test(t.address)) throw new ManifestError(`token address "${t.address}" is malformed`);
    if (!/^\d+$/.test(t.perPeriod)) {
      throw new ManifestError(`perPeriod "${t.perPeriod}" must be base units as digits`);
    }
    periodToSeconds(t.period);
  }
  if (periodToSeconds(p.expiry) <= 0) throw new ManifestError("expiry must be positive");
  if (p.maxCalls !== undefined) {
    if (!/^\d+$/.test(p.maxCalls) || Number(p.maxCalls) <= 0) {
      throw new ManifestError("maxCalls must be a positive integer");
    }
  }
}

/** Parse the YAML frontmatter of a SKILL.md into Permissions. */
export function parsePermissions(frontmatter: string): Permissions {
  const lines = frontmatter.split("\n");
  const start = lines.findIndex((l) => l.trim() === "permissions:");
  if (start === -1) throw new ManifestError("no permissions block in frontmatter");

  const indent = (lines[start] ?? "").search(/\S/);
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() !== "" && line.search(/\S/) <= indent) break;
    block.push(line);
  }

  const parsed = parseBlock(block, 0) as unknown;
  const permissions = parsed as Permissions;
  validatePermissions(permissions);
  return permissions;
}

/**
 * Minimal indentation-based YAML reader.
 *
 * Deliberately not a YAML library. We only accept the narrow shape we propose, and
 * a real parser would happily accept aliases, anchors and merge keys in a document
 * that becomes on-chain policy.
 *
 * Handles exactly two shapes: `key: value` and lists whose items are either a bare
 * scalar or a map. A list item like `- address: 0x...` followed by an indented
 * `methods:` list is a map item, which is the case the first version of this
 * function silently flattened into one string.
 */
function parseBlock(lines: string[], depth: number): unknown {
  const first = lines.find((l) => l.trim() !== "");
  if (first === undefined) return null;
  if (first.trimStart().startsWith("- ")) return parseList(lines, depth);
  return parseMap(lines, depth);
}

function parseList(lines: string[], depth: number): unknown[] {
  const items: unknown[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    if (!line.trimStart().startsWith("- ")) break;

    const dashIndent = line.search(/\S/);
    const first = line.trimStart().slice(2);
    i += 1;
    // Re-indent the first line to where it sits after the dash, so the item and
    // its continuations share one indent base. Without this, parseMap sees a line
    // indented 0 next to a depth of 6, decides the block ended, and returns {}.
    const continuations: string[] = [];
    // Continuations are indented past the dash, so they belong to this item.
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim() === "") {
        continuations.push("");
        i += 1;
        continue;
      }
      if (next.search(/\S/) <= dashIndent) break;
      continuations.push(next);
      i += 1;
    }
    // A single-line item is a scalar. Only a continued item is a map, otherwise
    // "eip155:10143" parses as {eip155: "10143"} instead of the string.
    const hasBody = continuations.some((l) => l.trim() !== "");
    items.push(
      hasBody ? parseBlock([" ".repeat(dashIndent + 2) + first, ...continuations], dashIndent + 2) : parseScalar(first),
    );
  }
  return items;
}

function parseMap(lines: string[], depth: number): unknown {
  const obj: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const currentIndent = line.search(/\S/);
    if (depth > 0 && currentIndent < depth) break;
    const match = /^([^:]+):\s*(.*)$/.exec(line.trim());
    const key = match?.[1]?.trim();
    if (key === undefined) {
      i += 1;
      continue;
    }
    const inline = match?.[2]?.trim() ?? "";
    if (inline !== "") {
      obj[key] = parseScalar(inline);
      i += 1;
      continue;
    }
    const child: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j] ?? "";
      if (next.trim() !== "" && next.search(/\S/) <= currentIndent) break;
      child.push(next);
      j += 1;
    }
    obj[key] = parseBlock(child, currentIndent + 2);
    i = j;
  }
  return obj;
}

/**
 * Integers stay strings. A base-unit amount like 500000000000000000 is above
 * 2^53, so Number() would silently round it and the cap we compile would not be the
 * cap the user asked for. Callers convert explicitly with BigInt where they need a
 * number, and Number where a small count is intended.
 */
function parseScalar(raw: string): unknown {
  let out = raw.trim();
  const first = out[0];
  if ((first === '"' || first === "'") && out.length >= 2 && out.endsWith(first)) {
    out = out.slice(1, -1);
  }
  if (out === "true") return true;
  if (out === "false") return false;
  return out;
}
