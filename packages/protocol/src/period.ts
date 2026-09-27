/** Period arithmetic and the manifest validation error type. */

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

const MULTIPLIER = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 } as const;

export type Period = `${number}${"s" | "m" | "h" | "d" | "w"}`;

export function periodToSeconds(period: Period | string): number {
  const match = /^(\d+)([smhdw])$/.exec(period);
  const amount = match?.[1];
  const unit = match?.[2] as keyof typeof MULTIPLIER | undefined;
  if (amount === undefined || unit === undefined) {
    throw new ManifestError(`invalid period "${period}", expected <number><s|m|h|d|w>`);
  }
  return Number(amount) * MULTIPLIER[unit];
}
