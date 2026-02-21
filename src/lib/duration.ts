const UNITS: Record<string, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
};

const DURATION_RE = /^(\d+(?:\.\d+)?)(m|h|d)$/;

/** Parse a duration string like "12h", "1d", "30m" into milliseconds. */
export function parseDuration(input: string): number {
  const match = DURATION_RE.exec(input);
  if (!match) {
    throw new Error(`Invalid duration: "${input}" (expected e.g. "30m", "12h", "1d")`);
  }
  const value = parseFloat(match[1] ?? "");
  const unit = UNITS[match[2] ?? ""] ?? 0;
  return value * unit;
}

/** Regex for validating duration strings in zod schemas. */
export const DURATION_PATTERN = DURATION_RE;
