/**
 * Email pattern detective — finds the real email format a company uses.
 * No paid API. Uses targeted search queries + regex extraction + pattern inference.
 *
 * Strategy:
 * 1. Run 2 focused searches designed to surface real email addresses at the domain
 * 2. Extract every "@domain" email from snippets/titles using regex
 * 3. Filter out generic addresses (noreply, support, etc.)
 * 4. Cross-reference found emails against known recruiter names to confirm pattern
 * 5. Infer the pattern from the email format (e.g. j.smith → {f}.{last})
 */

import type { SearchProvider } from "@/lib/search/base";

export interface EmailPatternResult {
  pattern: string | null;          // e.g. "{first}.{last}", "{f}{last}", "{first}"
  confidence: "confirmed" | "likely" | "none";
  examples: string[];              // real emails found (evidence)
  domain: string;
}

const GENERIC_PREFIXES = [
  "noreply", "no-reply", "support", "hello", "info", "contact",
  "admin", "help", "team", "hr", "jobs", "careers", "recruiting",
  "talent", "press", "media", "legal", "billing", "sales", "security",
  "privacy", "abuse", "postmaster", "webmaster", "newsletter",
];

/**
 * Run targeted searches to find the email pattern for a company domain.
 * Uses 2 Serper queries — cheap and fast.
 */
export async function detectEmailPattern(
  domain: string,
  searchProvider: SearchProvider
): Promise<EmailPatternResult> {
  const queries = [
    // Query 1: Find pages that openly show @domain emails (exclude generic)
    `"@${domain}" -noreply -support -info -contact -careers`,
    // Query 2: Hunter.io + Apollo public pages often show email format
    `"${domain}" email format site:hunter.io OR site:apollo.io OR "email pattern"`,
  ];

  const results = await Promise.all(
    queries.map((q) =>
      searchProvider.search(q, 10).catch(() => null)
    )
  );

  // Regex to find email-like patterns in text
  const emailRegex = /\b[\w.+%-]{1,30}@[\w.-]+\.[a-z]{2,}\b/gi;

  const foundEmails: string[] = [];
  const rootDomain = domain.replace(/^www\./, "");

  for (const resp of results) {
    if (!resp) continue;
    for (const r of resp.results) {
      const text = `${r.title} ${r.snippet} ${r.content ?? ""}`;
      const matches = text.match(emailRegex) ?? [];
      for (const email of matches) {
        const lower = email.toLowerCase();
        // Only keep emails at the target domain
        if (lower.endsWith(`@${rootDomain}`) || lower.endsWith(`@${domain}`)) {
          foundEmails.push(lower);
        }
      }
    }
  }

  // Deduplicate
  const unique = [...new Set(foundEmails)];

  // Filter out generic/role addresses
  const personal = unique.filter((e) => {
    const local = e.split("@")[0];
    return !GENERIC_PREFIXES.some(
      (p) => local === p || local.startsWith(`${p}.`) || local.startsWith(`${p}+`)
    );
  });

  if (personal.length === 0) {
    return { pattern: null, confidence: "none", examples: [], domain };
  }

  // Infer the pattern from the personal emails found
  const pattern = inferPattern(personal);
  const confidence = personal.length >= 3 ? "confirmed" : "likely";

  return { pattern, confidence, examples: personal.slice(0, 5), domain };
}

/**
 * Infer an email pattern from a list of real email local-parts.
 * Uses structural analysis (dot position, length, character distribution).
 */
function inferPattern(emails: string[]): string {
  const locals = emails.map((e) => e.split("@")[0]);

  const scores: Record<string, number> = {
    "{first}.{last}": 0,
    "{f}{last}": 0,
    "{first}": 0,
    "{first}{last}": 0,
    "{f}.{last}": 0,
    "{first}{l}": 0,
    "{first}_{last}": 0,
  };

  for (const local of locals) {
    if (/^[a-z]{2,}[._][a-z]{2,}$/.test(local)) {
      // Has separator like "john.doe" or "john_doe"
      if (local.includes(".")) scores["{first}.{last}"] += 2;
      if (local.includes("_")) scores["{first}_{last}"] += 2;
    } else if (/^[a-z]{1}[a-z]{2,10}$/.test(local) && local.length <= 8) {
      // Short, no separator — likely "jsmith" ({f}{last}) or "jdoe"
      scores["{f}{last}"] += 2;
    } else if (/^[a-z]{1}\.[a-z]{2,}$/.test(local)) {
      // "j.smith" format
      scores["{f}.{last}"] += 2;
    } else if (/^[a-z]{2,8}$/.test(local)) {
      // Could be just first name "sarah" or "john"
      scores["{first}"] += 1;
    } else if (/^[a-z]{4,20}$/.test(local) && local.length > 8) {
      // Longer no-separator like "johnsmith"
      scores["{first}{last}"] += 1;
    } else if (/^[a-z]{3,}[a-z]$/.test(local) && local.length >= 5 && local.length <= 10) {
      // Could be "johnd" — first + last initial
      scores["{first}{l}"] += 1;
    }
  }

  // Return the highest-scoring pattern
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const best = sorted[0];

  // Default to first.last if no clear winner (most common in tech)
  return best && best[1] > 0 ? best[0] : "{first}.{last}";
}

/**
 * Cross-reference found emails against a recruiter name to confirm/adjust pattern.
 * If we know "Sarah Chen" and find "schen@company.com", we confirm {f}{last}.
 */
export function confirmPatternFromName(
  email: string,
  firstName: string,
  lastName: string
): string | null {
  const local = email.split("@")[0].toLowerCase();
  const f = firstName.toLowerCase().replace(/[^a-z]/g, "");
  const l = lastName.toLowerCase().replace(/[^a-z]/g, "");
  if (!f || !l) return null;

  if (local === `${f}.${l}`) return "{first}.{last}";
  if (local === `${f[0]}${l}`) return "{f}{last}";
  if (local === `${f}`) return "{first}";
  if (local === `${f}${l}`) return "{first}{last}";
  if (local === `${f[0]}.${l}`) return "{f}.{last}";
  if (local === `${f}${l[0]}`) return "{first}{l}";
  if (local === `${f}_${l}`) return "{first}_{last}";

  return null;
}
