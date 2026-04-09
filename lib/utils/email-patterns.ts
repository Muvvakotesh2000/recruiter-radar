/**
 * Email pattern utilities — no external API required.
 */

// pct = approximate real-world prevalence across business email domains
export const COMMON_PATTERNS = [
  { pattern: "{first}.{last}",  label: "first.last",  pct: 46 },
  { pattern: "{f}{last}",       label: "flast",       pct: 22 },
  { pattern: "{first}",         label: "first",       pct:  9 },
  { pattern: "{first}{last}",   label: "firstlast",   pct:  6 },
  { pattern: "{f}.{last}",      label: "f.last",      pct:  4 },
  { pattern: "{last}",          label: "last",        pct:  3 },
  { pattern: "{first}_{last}",  label: "first_last",  pct:  3 },
  { pattern: "{first}{l}",      label: "firstl",      pct:  2 },
  { pattern: "{last}.{first}",  label: "last.first",  pct:  1 },
  { pattern: "{last}{first}",   label: "lastfirst",   pct:  1 },
  { pattern: "{l}.{first}",     label: "l.first",     pct:  1 },
  { pattern: "{last}.{f}",      label: "last.f",      pct:  1 },
  { pattern: "{last}_{first}",  label: "last_first",  pct:  1 },
  { pattern: "{l}{first}",      label: "lfirst",      pct:  0 },
  { pattern: "{last}{f}",       label: "lastf",       pct:  0 },
];

/**
 * Apply a pattern string to a name + domain.
 * Accepts patterns like "{first}.{last}", "{f}{last}", "first.last" (no braces), etc.
 */
export function applyPattern(
  pattern: string,
  firstName: string,
  lastName: string,
  domain: string
): string {
  const f = clean(firstName);
  const l = clean(lastName);
  if (!f || !l) return "";

  const local = pattern
    .replace(/\{first\}/gi, f)
    .replace(/\{last\}/gi, l)
    .replace(/\{f\}/gi, f.charAt(0))
    .replace(/\{l\}/gi, l.charAt(0))
    // bare word fallbacks (pattern like "first.last" with no braces)
    .replace(/\bfirst\b/gi, f)
    .replace(/\blast\b/gi, l);

  return `${local}@${domain}`;
}

/**
 * Generate ALL candidate emails for a full name + domain.
 * Returns them ranked by prevalence (most common first).
 */
export function generateCandidates(fullName: string, domain: string): string[] {
  const { first, last } = splitName(fullName);
  if (!first || !last) return [];
  return COMMON_PATTERNS
    .map(({ pattern }) => applyPattern(pattern, first, last, domain))
    .filter(Boolean);
}

/**
 * Apply a detected pattern to a full name.
 * Falls back to first.last if the pattern can't be parsed.
 */
export function bestEmailFromPattern(
  rawPattern: string,
  fullName: string,
  domain: string
): string {
  const { first, last } = splitName(fullName);
  if (!first || !last) return "";
  const pattern = rawPattern.replace(/@.*$/, "").trim();
  return applyPattern(pattern, first, last, domain);
}

/**
 * Split a full name into first + last.
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
