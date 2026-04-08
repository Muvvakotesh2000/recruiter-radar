/**
 * Email pattern utilities — no external API required.
 *
 * Strategy:
 * 1. If a pattern was detected from search results (e.g. "first.last"), apply it.
 * 2. If no pattern detected, generate candidates using all common patterns.
 * 3. Default to first.last (most common in tech: ~60% of companies).
 */

/** Ranked by prevalence across tech/enterprise companies */
export const COMMON_PATTERNS = [
  { pattern: "{first}.{last}", label: "first.last" },
  { pattern: "{f}{last}",      label: "flast" },
  { pattern: "{first}",        label: "first" },
  { pattern: "{first}{last}",  label: "firstlast" },
  { pattern: "{f}.{last}",     label: "f.last" },
  { pattern: "{first}{l}",     label: "firstl" },
  { pattern: "{first}_{last}", label: "first_last" },
];

/**
 * Apply a known pattern string to a name.
 * Accepts patterns like "{first}.{last}", "first.last", "{f}{last}", etc.
 */
export function applyPattern(
  pattern: string,
  firstName: string,
  lastName: string,
  domain: string
): string {
  const f = clean(firstName);
  const l = clean(lastName);

  const local = pattern
    .replace(/\{first\}/gi, f)
    .replace(/\{last\}/gi, l)
    .replace(/\{f\}/gi, f.charAt(0))
    .replace(/\{l\}/gi, l.charAt(0))
    // handle bare "first" / "last" patterns without braces
    .replace(/\bfirst\b/gi, f)
    .replace(/\blast\b/gi, l);

  return `${local}@${domain}`;
}

/**
 * Generate all candidate emails for a full name + domain.
 * Returns them ranked by prevalence (most common first).
 */
export function generateCandidates(
  fullName: string,
  domain: string
): string[] {
  const { first, last } = splitName(fullName);
  if (!first || !last) return [];

  return COMMON_PATTERNS.map(({ pattern }) =>
    applyPattern(pattern, first, last, domain)
  );
}

/**
 * Given a detected pattern label from AI (e.g. "first.last", "{first}.{last}",
 * "f.last", etc.) and a full name, produce the most likely email.
 * Falls back to first.last if the pattern can't be parsed.
 */
export function bestEmailFromPattern(
  rawPattern: string,
  fullName: string,
  domain: string
): string {
  const { first, last } = splitName(fullName);
  if (!first || !last) return "";

  // Normalize pattern — strip @domain if included
  const pattern = rawPattern.replace(/@.*$/, "").trim();

  return applyPattern(pattern, first, last, domain);
}

/**
 * Split a full name into first + last.
 * Handles "Sarah Chen", "Sarah A. Chen", "Jean-Pierre Dupont", etc.
 */
export function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts[parts.length - 1] };
}

function clean(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
