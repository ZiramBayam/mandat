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

export type Period = `${number}${"s" | "m" | "h" | "d" | "w"}`;

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
  maxCalls?: number;
};

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

const PERIOD_MULTIPLIER = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 } as const;

export function periodToSeconds(period: Period): number {
  const match = /^(\d+)([smhdw])$/.exec(period);
  const amount = match?.[1];
  const unit = match?.[2] as keyof typeof PERIOD_MULTIPLIER | undefined;
  if (amount === undefined || unit === undefined) {
    throw new ManifestError(`invalid period "${period}", expected <number><s|m|h|d|w>`);
  }
  return Number(amount) * PERIOD_MULTIPLIER[unit];
}

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
    if (!/^\d+$/.test(t.period)) throw new ManifestError(`perPeriod "${t.perPeriod}" must be base units as digits`);
    periodToSeconds(t.period);
  }
  if (periodToSeconds(p.expiry) <= 0) throw new ManifestError("expiry must be positive");
  if (p.maxCalls !== undefined && (!Number.isInteger(p.maxCalls) || p.maxCalls <= 0)) {
    throw new ManifestError("maxCalls must be a positive integer");
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
 * Deliberately not a YAML library. We only accept the narrow shape we propose,
 * and a real parser would happily accept aliases, anchors and merge keys that we
 * do not want in a document that becomes on-chain policy.
 */
function parseBlock(lines: string[], depth: number): unknown {
  if (lines.length === 0) return null;
  const first = lines[0] ?? "";
  if (first.trimStart().startsWith("- ")) {
    const items: unknown[] = [];
    let current: string[] = [];
    for (const line of lines) {
      if (line.trimStart().startsWith("- ")) {
        if (current.length > 0) items.push(parseScalar(current.join(" ").trim()));
        current = [line.trimStart().slice(2)];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) items.push(parseScalar(current.join(" ").trim()));
    return items;
  }

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

function parseScalar(raw: string): unknown {
  const unquoted = raw.replace(/^["']|["']$/g, "");
  if (unquoted === "true") return true;
  if (unquoted === "false") return false;
  if (/^\d+$/.test(unquoted)) return Number(unquoted);
  return unquoted;
}
