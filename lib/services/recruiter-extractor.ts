/**
 * Non-AI recruiter extraction from search results.
 *
 * Parses structured Google snippets from:
 *   - LinkedIn profile pages  (highest signal)
 *   - Apollo.io / RocketReach (contact databases, often have emails)
 *
 * Pipeline role:
 *   filterResultsBySignal → parseAllResults → deduplicateLeads → scoreLead
 *
 * No API calls or AI usage — pure regex + heuristics.
 */

import type { SearchResult } from "@/lib/search/base";
import type { RecruiterSearchInput } from "@/types/ai";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedLead {
  full_name: string;
  job_title: string;
  company: string;
  location: string | null;
  linkedin_url: string | null;
  email: string | null;
  email_type: "verified" | "estimated" | "unknown";
  source: string;
  confidence_level: "High" | "Medium" | "Low";
  score: number;
  outreach_message: string;
}

// ─── Title classification ───────────────────────────────────────────────────────

const PRIMARY_RECRUITER_TERMS = [
  "technical recruiter",
  "tech recruiter",
  "talent acquisition",
  "talent partner",
  "talent lead",
  "sourcer",
  "staffing specialist",
  "recruiting partner",
  "recruiting coordinator",
  "recruiting manager",
  "talent scout",
  "university recruiter",
  "campus recruiter",
  "recruiter",
];

const SECONDARY_HIRING_TERMS = [
  "hiring manager",
  "engineering manager",
  "head of talent",
  "people operations",
  "hr partner",
  "human resources",
  "director of engineering",
  "vp of engineering",
  "people team",
  "people ops",
];

// Titles that indicate the result is a candidate, not a recruiter
const NOISE_TERMS = [
  "software engineer",
  "data scientist",
  "product manager",
  "student at",
  "looking for",
  "open to work",
  "seeking opportunities",
  "developer",
  "designer",
  "analyst",
  "consultant",
  "intern",
];

export function classifyTitle(title: string): "primary" | "secondary" | "noise" | "unknown" {
  const t = title.toLowerCase();
  if (NOISE_TERMS.some((k) => t.includes(k))) return "noise";
  if (PRIMARY_RECRUITER_TERMS.some((k) => t.includes(k))) return "primary";
  if (SECONDARY_HIRING_TERMS.some((k) => t.includes(k))) return "secondary";
  return "unknown";
}

// ─── Company matching ───────────────────────────────────────────────────────────

export function fuzzyCompanyMatch(resultCompany: string, inputCompany: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|corp|co\b|group|the|&|and)\b/g, " ")
      .replace(/[^a-z0-9]/g, "")
      .trim();
  const r = norm(resultCompany);
  const c = norm(inputCompany);
  if (!r || !c || r.length < 2 || c.length < 2) return false;
  const shorter = r.length <= c.length ? r : c;
  const longer = r.length <= c.length ? c : r;
  return longer.includes(shorter) || (shorter.length >= 4 && longer.startsWith(shorter.slice(0, 4)));
}

// ─── Location extraction ────────────────────────────────────────────────────────

const LOCATION_PATTERNS = [
  /Location[:\s]+([A-Z][^.\n]{3,45}?)(?:\s*\.|$)/i,
  /\bbased in\s+([A-Z][^.\n,]{3,35}(?:,\s*[A-Z]{2,})?)/i,
  /\bin\s+([A-Z][a-z]+(?: [A-Z][a-z]+)*,\s*(?:[A-Z]{2}|[A-Z][a-z]+))/,
  /([A-Z][a-z]+(?: [A-Z][a-z]+)*),\s*([A-Z]{2})\b/,
  /([A-Z][a-z]+(?: [A-Z][a-z]+)*)\s+Area\b/,
];

export function extractLocation(text: string): string | null {
  for (const rx of LOCATION_PATTERNS) {
    const m = text.match(rx);
    if (m) {
      const loc = (m[1] ?? "").trim();
      if (
        loc.length >= 3 &&
        loc.length <= 50 &&
        !/^(the|a|an|and|or|at|in|is|are)\b/i.test(loc)
      ) {
        return loc;
      }
    }
  }
  return null;
}

// ─── LinkedIn profile parser ─────────────────────────────────────────────────────

/**
 * Google indexes LinkedIn profiles with a predictable title format:
 *   "FirstName LastName - Job Title at Company | LinkedIn"
 *
 * This parser extracts name, title, company without any AI call.
 */
export function parseLinkedInResult(
  result: SearchResult,
  companyName: string
): ParsedLead | null {
  if (!result.url.includes("linkedin.com/in/")) return null;

  // Match: "Name - Title at Company | LinkedIn"
  // Handles: "Name – Title at Company, City | LinkedIn"
  const m = result.title.match(
    /^([A-Z][A-Za-z'\-.\s]{1,40}?)\s*[–\-]\s*(.{4,80}?)\s+(?:at|@)\s+([^|,]{3,55}?)(?:,\s*[^|]+?)?\s*\|/
  );

  if (!m) return null;

  const [, rawName, rawTitle, rawCompany] = m;

  if (!fuzzyCompanyMatch(rawCompany.trim(), companyName)) return null;

  const titleClass = classifyTitle(rawTitle.trim());
  // Only include results with a recognizable recruiter or hiring title
  if (titleClass === "noise" || titleClass === "unknown") return null;

  const location =
    extractLocation(result.snippet) ?? extractLocation(result.title);

  const emailMatch = result.snippet.match(/\b[\w.+%-]{2,30}@[\w.-]+\.[a-z]{2,}\b/i);
  const email = emailMatch?.[0]?.toLowerCase() ?? null;

  return {
    full_name: rawName.trim(),
    job_title: rawTitle.trim(),
    company: rawCompany.trim(),
    location,
    linkedin_url: result.url,
    email,
    email_type: email ? "verified" : "unknown",
    source: `[${result.url}] ${result.snippet.slice(0, 100)}`,
    confidence_level: titleClass === "primary" ? "High" : "Medium",
    score: 0,
    outreach_message: "",
  };
}

// ─── Contact DB parser (Apollo, RocketReach) ─────────────────────────────────────

/**
 * Apollo title: "Name - Company | Apollo"
 * RocketReach title: "Name Email & Phone - Company | RocketReach"
 * Snippets often contain title + email directly.
 */
export function parseContactDBResult(
  result: SearchResult,
  companyName: string
): ParsedLead | null {
  const isApollo = result.url.includes("apollo.io");
  const isRR = result.url.includes("rocketreach.co");
  if (!isApollo && !isRR) return null;

  const m = result.title.match(
    /^([A-Z][A-Za-z'\-.\s]{1,40}?)\s*(?:Email[^|]*?)?\s*[-–]\s*([^|]{2,55}?)\s*\|/i
  );

  if (!m) return null;

  const [, rawName, rawCompany] = m;
  if (!fuzzyCompanyMatch(rawCompany.trim(), companyName)) return null;

  // Try to extract job title from snippet
  const titleInSnippet = result.snippet.match(
    /\b((?:technical |senior |lead |principal |staff )?(?:recruiter|talent acquisition|sourcer|hiring manager|staffing)[A-Za-z\s]{0,30})/i
  );
  const jobTitle = titleInSnippet?.[1]?.trim() ?? "Talent Acquisition";

  const titleClass = classifyTitle(jobTitle);
  if (titleClass === "noise") return null;

  const location = extractLocation(result.snippet);
  const emailMatch = result.snippet.match(/\b[\w.+%-]{2,30}@[\w.-]+\.[a-z]{2,}\b/i);
  const email = emailMatch?.[0]?.toLowerCase() ?? null;

  return {
    full_name: rawName.trim(),
    job_title: jobTitle,
    company: rawCompany.trim(),
    location,
    linkedin_url: null,
    email,
    email_type: email ? "verified" : "unknown",
    source: `[${result.url}] ${result.snippet.slice(0, 100)}`,
    confidence_level: titleClass === "primary" ? "High" : "Medium",
    score: 0,
    outreach_message: "",
  };
}

// ─── Pre-filtering ─────────────────────────────────────────────────────────────

/**
 * Keep only results that contain:
 * 1. Company name mention
 * 2. Recruiter-related keyword OR is a profile/contact page URL
 *
 * Drops job board listings, news articles, and engineer profiles early
 * so the AI (when used) receives cleaner input.
 */
export function filterResultsBySignal(
  results: SearchResult[],
  companyName: string
): SearchResult[] {
  const companyNorm = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const allRecruiterTerms = [...PRIMARY_RECRUITER_TERMS, ...SECONDARY_HIRING_TERMS];

  return results.filter((r) => {
    const text = `${r.title} ${r.snippet}`.toLowerCase();
    const textNorm = text.replace(/[^a-z0-9\s]/g, "");

    const hasCompany =
      text.includes(companyName.toLowerCase()) || textNorm.includes(companyNorm);
    if (!hasCompany) return false;

    const isProfileURL =
      r.url.includes("linkedin.com/in/") ||
      r.url.includes("apollo.io") ||
      r.url.includes("rocketreach.co");

    const hasRecruiterSignal = allRecruiterTerms.some((k) => text.includes(k));

    return isProfileURL || hasRecruiterSignal;
  });
}

// ─── Extract all results without AI ───────────────────────────────────────────

/**
 * Attempt to parse every result using structural patterns.
 * Returns the parsed leads and the results that couldn't be parsed.
 */
export function extractWithoutAI(
  results: SearchResult[],
  companyName: string
): { parsed: ParsedLead[]; unprocessed: SearchResult[] } {
  const parsed: ParsedLead[] = [];
  const unprocessed: SearchResult[] = [];

  for (const r of results) {
    const lead =
      parseLinkedInResult(r, companyName) ?? parseContactDBResult(r, companyName);
    if (lead) {
      parsed.push(lead);
    } else {
      unprocessed.push(r);
    }
  }

  return { parsed, unprocessed };
}

// ─── Deduplication ─────────────────────────────────────────────────────────────

function normName(n: string): string {
  return n.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Merge leads that refer to the same person (matched by normalized name).
 * Keeps the most complete record from each duplicate.
 */
export function deduplicateLeads(leads: ParsedLead[]): ParsedLead[] {
  const map = new Map<string, ParsedLead>();

  for (const lead of leads) {
    const key = normName(lead.full_name);
    if (!key || key.length < 4) continue;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, lead);
    } else {
      const emailType =
        existing.email_type === "verified" || lead.email_type === "verified"
          ? "verified"
          : existing.email_type === "estimated" || lead.email_type === "estimated"
          ? "estimated"
          : "unknown";

      const confidenceRank = { High: 2, Medium: 1, Low: 0 };
      const betterConfidence =
        (confidenceRank[existing.confidence_level] ?? 0) >=
        (confidenceRank[lead.confidence_level] ?? 0)
          ? existing.confidence_level
          : lead.confidence_level;

      map.set(key, {
        ...existing,
        linkedin_url: existing.linkedin_url ?? lead.linkedin_url,
        email: existing.email ?? lead.email,
        email_type: emailType,
        location: existing.location ?? lead.location,
        job_title:
          existing.job_title.length >= lead.job_title.length
            ? existing.job_title
            : lead.job_title,
        confidence_level: betterConfidence,
        score: Math.max(existing.score, lead.score),
      });
    }
  }

  return Array.from(map.values());
}

// ─── Quality scoring ─────────────────────────────────────────────────────────────

/**
 * Score a lead by how well it matches the job context.
 * Used to sort final results (highest score = shown first).
 */
export function scoreLead(lead: ParsedLead, input: RecruiterSearchInput): number {
  let score = 0;

  // Company confirmed (base)
  score += 30;

  // Title quality
  const tc = classifyTitle(lead.job_title);
  if (tc === "primary") score += 20;
  else if (tc === "secondary") score += 8;
  else score -= 5;

  // Location match — location-first priority
  const jobLocs = input.location
    .split(/[\/,;]|\band\b/i)
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);

  if (lead.location) {
    const ll = lead.location.toLowerCase();
    const exactCityMatch = jobLocs.some((jl) => {
      const jlCity = jl.split(",")[0].trim();
      const llCity = ll.split(",")[0].trim();
      return ll.includes(jlCity) || jl.includes(llCity);
    });
    if (exactCityMatch) {
      score += 20; // strong location bonus
    } else {
      score += 2; // has a location but different city
    }
  } else {
    score -= 5; // unknown location penalized
  }

  // Verified source
  if (lead.linkedin_url) score += 10;
  if (lead.email) score += 5;
  if (lead.email_type === "verified") score += 3;

  return score;
}

// ─── Template outreach message ────────────────────────────────────────────────

/**
 * Generate a personalized outreach message without AI.
 * Location-conditional: only mentions shared location if it matches.
 */
export function generateOutreachMessage(
  lead: ParsedLead,
  input: RecruiterSearchInput
): string {
  const firstName = lead.full_name.split(/\s+/)[0];
  const { company_name, job_title, location } = input;

  const jobLocs = location
    .split(/[\/,;]|\band\b/i)
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);

  const leadCity = lead.location?.split(",")[0]?.trim().toLowerCase() ?? null;

  const sharedLocation =
    leadCity &&
    jobLocs.some(
      (jl) => jl.includes(leadCity) || leadCity.includes(jl.split(",")[0].trim())
    );

  let msg = `Hi ${firstName}, I recently applied for the ${job_title} role at ${company_name} in ${location}.`;

  if (sharedLocation && lead.location) {
    msg += ` I noticed you're also based in ${lead.location} — great to see a local connection!`;
  }

  msg += ` Are you involved with this opening or could you point me to the right person? Would love to hear more about the role and the team if you have a moment. Thanks!`;

  return msg;
}
