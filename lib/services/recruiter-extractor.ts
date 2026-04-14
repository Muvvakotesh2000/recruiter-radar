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
  "recruiting lead",
  "head of talent",
  "head of recruiting",
  "people operations",
  "hr partner",
  "hr business partner",
  "human resources",
  "director of engineering",
  "vp of engineering",
  "people team",
  "people ops",
];

// Titles that indicate the result is a candidate, not a recruiter
const NOISE_TERMS = [
  "software engineer",
  "senior software engineer",
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
  "job opening",
  "jobs at",
  "careers",
  "company profile",
];

const COMPANY_PAGE_WORDS = /\b(company|careers|jobs|job|hiring|profile|overview|about|inc|llc|ltd|corp|corporation|group|team)\b/i;
const AMBIGUOUS_COMPANY_WORDS = new Set([
  "current",
  "remote",
  "box",
  "square",
  "wise",
  "affirm",
  "toast",
  "ramp",
  "bench",
  "pilot",
  "scale",
]);

function normText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hasRecruiterSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return [...PRIMARY_RECRUITER_TERMS, ...SECONDARY_HIRING_TERMS].some((k) =>
    lower.includes(k)
  );
}

function hasNoiseSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return NOISE_TERMS.some((k) => lower.includes(k));
}

export function isLikelyPersonName(name: string, companyName: string): boolean {
  const cleaned = name
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(email|phone|linkedin|profile)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);

  if (words.length < 2 || words.length > 4) return false;
  if (cleaned.length < 5 || cleaned.length > 55) return false;
  if (COMPANY_PAGE_WORDS.test(cleaned)) return false;
  if (normText(cleaned) === normText(companyName)) return false;
  if (fuzzyCompanyMatch(cleaned, companyName)) return false;
  if (!words.every((word) => /^[A-Z][A-Za-z'().-]*$/.test(word))) return false;

  return true;
}

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
      .replace(/[^a-z0-9]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const r = norm(resultCompany);
  const c = norm(inputCompany);
  if (!r || !c || r.length < 2 || c.length < 2) return false;
  if (r === c) return true;
  const shorter = r.length <= c.length ? r : c;
  const longer = r.length <= c.length ? c : r;
  // Require word-boundary match to avoid "Apple" matching "Snapple" or "Pineapple"
  const escaped = shorter.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&").replace(/\s+/g, " +");
  return new RegExp(`(?:^| )${escaped}(?= |$)`).test(longer);
}

function isAmbiguousCompanyName(companyName: string): boolean {
  const normalized = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return AMBIGUOUS_COMPANY_WORDS.has(normalized);
}

function hasCompanyMention(text: string, companyName: string): boolean {
  const companyNorm = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const textNorm = text.toLowerCase().replace(/[^a-z0-9\s]/g, "");

  if (!isAmbiguousCompanyName(companyName)) {
    return text.toLowerCase().includes(companyName.toLowerCase()) || textNorm.includes(companyNorm);
  }

  return companyInEmploymentContext(text, companyName);
}

/** Words that indicate a non-employment relationship with the company */
const CERT_WORDS = /\b(certified|certification|certificate|credential|badge|course|training|bootcamp|program|exam|assessment|licensed|accredited|issued by|awarded by|completion)\b/i;

/**
 * Signals that a person is a *former* employee of a *specific company*.
 * "former"/"ex-"/"previously" almost always appear BEFORE the company name
 * (e.g. "Former Recruiter at Acme", "Previously at Acme").
 * We do NOT include "alumni"/"alum" here — those are too often university
 * references (e.g. "CMU Alumni") and would cause false rejections.
 */
const FORMER_WORDS = /\b(former|formerly|ex[-\s]|previously|past\s+\w+\s+at|left\s+|no\s+longer)\b/i;

/** Past year range — e.g. "2019 - 2022", "Mar 2020 – Dec 2024". End year must be < current year. */
const PAST_YEAR_RE = /\b(20\d{2})\s*[-–]\s*(201[0-9]|202[0-4])\b/;

/**
 * Returns true if the title or snippet indicates the person used to work
 * at THIS SPECIFIC COMPANY but no longer does.
 *
 * Only checks the 60 chars BEFORE the company name for explicit "former"
 * signals, since "Former X at Acme" always puts the signal word before
 * the company. Checking after the company causes false positives like
 * "Acme ... CMU Alumni" or "Acme ... Ex-Google Engineer" rejecting
 * current Acme employees.
 *
 * For date ranges (e.g. "Acme · 2019 - 2022"), checks ±60 chars around
 * the company name since those appear on either side.
 */
export function looksLikeFormerEmployee(title: string, snippet: string, companyName: string): boolean {
  const combined = `${title} ${snippet}`.toLowerCase();
  const cn = companyName.toLowerCase();
  const idx = combined.indexOf(cn);

  if (idx === -1) return false;

  // Check LEFT of company name for "former"/"previously"/"ex-" (60 chars before)
  const leftWindow = combined.slice(Math.max(0, idx - 60), idx);
  if (FORMER_WORDS.test(leftWindow)) return true;

  // Check ±60 chars for past year ranges (date ranges can appear on either side)
  const dateWindow = combined.slice(Math.max(0, idx - 60), idx + cn.length + 60);
  if (PAST_YEAR_RE.test(dateWindow) && !/\bpresent\b/i.test(dateWindow)) return true;

  return false;
}

/**
 * Check if the company appears in an employment context in the snippet.
 * Returns false for certification/credential contexts even if the company
 * name matches — e.g. "Google Certified" or "AWS Certificate" should NOT
 * count as the person working at Google / AWS.
 */
export function companyInEmploymentContext(snippet: string, companyName: string): boolean {
  const escapedCompany = companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  if (isAmbiguousCompanyName(companyName)) {
    return new RegExp(`(?:\\bat\\b|@|Â·|â€¢|\\||[-â€“â€”])\\s*${escapedCompany}\\b`, "i").test(snippet);
  }

  const s = snippet.toLowerCase();
  const cn = companyName.toLowerCase();
  const idx = s.indexOf(cn);
  if (idx === -1) return false;

  // Check 40 chars around the match for certification language — reject immediately
  const window = s.slice(Math.max(0, idx - 40), idx + cn.length + 40);
  if (CERT_WORDS.test(window)) return false;

  // Within the first 80 chars → likely current employer in profile headline
  if (idx < 80) return true;
  // Preceded by employment words: "at", "@", "·", "with", "for"
  const before = s.slice(Math.max(0, idx - 25), idx);
  if (/(\bat\b|@|·|with\b|for\b)\s*$/.test(before)) return true;
  // Followed immediately by recruiter-role words (e.g. "CompanyX Recruiter")
  const after = s.slice(idx + cn.length, idx + cn.length + 20);
  if (/^\s*(recruiter|talent|sourcer|hiring|hr |people )/.test(after)) return true;
  return false;
}

/** Returns true if the string looks like a certification title, not a company name */
function looksLikeCertification(text: string): boolean {
  return CERT_WORDS.test(text);
}

// ─── State + Metro maps ─────────────────────────────────────────────────────────

/** US state abbreviation → full name */
const STATE_ABBR: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "Washington DC",
};

/**
 * Metro / regional aliases — maps a primary city name to its common regional labels.
 * Used for tier-1 location matching so "Bay Area" matches a job in "San Francisco".
 */
const METRO_ALIASES: Record<string, string[]> = {
  "san francisco": ["bay area", "sf bay area", "silicon valley", "greater san francisco", "sf", "east bay", "south bay", "peninsula", "san jose", "oakland", "berkeley"],
  "san jose":      ["bay area", "sf bay area", "silicon valley", "greater san jose", "south bay"],
  "new york":      ["nyc", "new york city", "greater new york", "tri-state area", "metro new york", "brooklyn", "queens", "manhattan", "bronx", "new jersey", "nj"],
  "los angeles":   ["la", "greater los angeles", "los angeles metropolitan area", "la metropolitan area", "socal", "so cal", "southern california", "long beach", "pasadena", "orange county", "oc", "inland empire", "santa monica", "burbank", "el segundo", "culver city", "manhattan beach", "torrance"],
  "el segundo":    ["los angeles", "greater los angeles", "los angeles metropolitan area", "la metropolitan area", "socal", "so cal", "southern california", "santa monica", "culver city", "manhattan beach", "torrance"],
  "seattle":       ["greater seattle", "puget sound", "bellevue", "redmond", "kirkland", "eastside"],
  "chicago":       ["greater chicago", "chicagoland", "chicagoland area", "evanston", "naperville"],
  "boston":        ["greater boston", "metro boston", "cambridge ma", "cambridge", "somerville", "waltham", "quincy"],
  "austin":        ["greater austin", "round rock", "cedar park", "pflugerville", "austin metro"],
  "dallas":        ["dfw", "dallas fort worth", "greater dallas", "fort worth", "plano", "irving", "frisco", "mckinney", "dallas-fort worth"],
  "houston":       ["greater houston", "the woodlands", "sugar land", "katy"],
  "denver":        ["greater denver", "metro denver", "boulder", "aurora", "lakewood", "denver metro"],
  "miami":         ["greater miami", "south florida", "fort lauderdale", "boca raton", "miami-dade"],
  "atlanta":       ["greater atlanta", "metro atlanta", "buckhead", "alpharetta", "marietta"],
  "washington":    ["dc", "dmv", "washington dc", "greater washington", "nova", "northern virginia", "arlington va", "bethesda", "silver spring", "reston"],
  "philadelphia":  ["greater philadelphia", "philly", "metro philadelphia", "wilmington"],
  "phoenix":       ["greater phoenix", "metro phoenix", "scottsdale", "tempe", "chandler", "mesa"],
  "san diego":     ["greater san diego", "metro san diego"],
  "minneapolis":   ["twin cities", "greater minneapolis", "saint paul", "st paul", "minneapolis-st paul"],
  "portland":      ["greater portland", "metro portland", "beaverton", "hillsboro"],
  "salt lake":     ["salt lake city", "greater salt lake", "slc", "provo", "orem"],
  "raleigh":       ["research triangle", "triangle", "rtp", "research triangle park", "durham", "chapel hill", "cary"],
  "nashville":     ["greater nashville", "metro nashville"],
  "charlotte":     ["greater charlotte", "metro charlotte"],
  "detroit":       ["greater detroit", "metro detroit", "ann arbor"],
  "st louis":      ["saint louis", "greater st louis", "metro st louis"],
  "kansas city":   ["greater kansas city", "metro kansas city"],
  "tampa":         ["greater tampa", "tampa bay", "st petersburg", "clearwater"],
  "orlando":       ["greater orlando", "central florida"],
};

/**
 * Build tiered location sets from a job's location string.
 *
 * - tier0: exact city tokens (e.g. "austin", "tx")
 * - tier1: metro/regional aliases (e.g. "greater austin area", "round rock")
 * - tier2: state names and abbreviations
 */
export function buildLocationTiers(location: string): {
  tier0: string[];
  tier1: string[];
  tier2: string[];
} {
  const tier0: string[] = [];
  const tier1: string[] = [];
  const tier2: string[] = [];
  const add0 = (v: string) => { if (!tier0.includes(v)) tier0.push(v); };
  const add1 = (v: string) => { if (!tier1.includes(v)) tier1.push(v); };
  const add2 = (v: string) => { if (!tier2.includes(v)) tier2.push(v); };

  const parts = location
    .split(/[\/,;]|\band\b/i)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  for (const part of parts) {
    // Tier 0: exact tokens (full part + primary city word)
    add0(part);
    const words = part.split(/\s+/);
    const cityWord = words[0];
    if (cityWord.length > 2) add0(cityWord);

    // State abbreviation → full name
    const stateAbbr = words[words.length - 1].toUpperCase();
    if (STATE_ABBR[stateAbbr]) {
      add2(STATE_ABBR[stateAbbr].toLowerCase());
      add2(stateAbbr.toLowerCase());
    }

    // State full name already present (e.g. "Texas")
    for (const [abbr, full] of Object.entries(STATE_ABBR)) {
      if (part.includes(full.toLowerCase())) {
        add2(full.toLowerCase());
        add2(abbr.toLowerCase());
      }
    }

    // Tier 1: metro aliases for this city
    for (const [metroCity, aliases] of Object.entries(METRO_ALIASES)) {
      if (part.includes(metroCity) || (cityWord.length > 2 && (cityWord.includes(metroCity) || metroCity.includes(cityWord)))) {
        aliases.forEach((a) => add1(a.toLowerCase()));
        add1(metroCity.toLowerCase());
      }
    }
    // Also check if this part IS a metro alias → promote its primary city to tier0
    for (const [metroCity, aliases] of Object.entries(METRO_ALIASES)) {
      if (aliases.some((a) => a.toLowerCase() === part || part.includes(a.toLowerCase()))) {
        add0(metroCity.toLowerCase());
        aliases.forEach((a) => add1(a.toLowerCase()));
      }
    }
  }

  return { tier0, tier1, tier2 };
}

/** Match score for a lead location against tiered job location arrays. 0=best */
export function locationTierScore(
  leadLocation: string | null,
  tiers: { tier0: string[]; tier1: string[]; tier2: string[] }
): 0 | 1 | 2 | 3 {
  if (!leadLocation) return 3;
  const ll = leadLocation.toLowerCase();
  const llCity = ll.split(",")[0].trim();

  if (tiers.tier0.some((t) => ll.includes(t) || t.includes(llCity))) return 0;
  if (tiers.tier1.some((t) => ll.includes(t) || t.includes(llCity))) return 1;
  if (tiers.tier2.some((t) => ll.includes(t))) return 2;
  return 3;
}

// ─── Location extraction ────────────────────────────────────────────────────────

const LOCATION_PATTERNS = [
  // Explicit "Location:" label
  /Location[:\s]+([A-Z][^.\n]{3,45}?)(?:\s*\.|$)/i,
  // "based in City, ST"
  /\bbased in\s+([A-Z][^.\n,]{3,35}(?:,\s*[A-Z]{2,})?)/i,
  // "in City, State" or "in City, ST"
  /\bin\s+([A-Z][a-z]+(?: [A-Z][a-z]+)*,\s*(?:[A-Z]{2}|[A-Z][a-z]+))/,
  // "City, ST" pattern
  /([A-Z][a-z]+(?: [A-Z][a-z]+)*),\s*([A-Z]{2})\b/,
  // "Greater X Area" / "X Metropolitan Area" / "X Metro Area"
  /(Greater\s+[A-Z][a-z]+(?: [A-Z][a-z]+)*(?:\s+Area)?)/,
  /([A-Z][a-z]+(?: [A-Z][a-z]+)*\s+(?:Metropolitan|Metro)\s+Area)/,
  // "X Area" (Bay Area, Bay Area, etc.)
  /([A-Z][a-z]+(?: [A-Z][a-z]+)*)\s+Area\b/,
  // Standalone US state full name
  new RegExp(`\\b(${Object.values(STATE_ABBR).join("|")})\\b`),
];

const JUNK_LOCATION_WORDS = /^(the|a|an|and|or|at|in|is|are|view|see|linkedin|profile|connect|join|follow|experience|education|skills|summary|about|company|industry|website|sector|employees|founded|type)\b/i;
const ROLE_WORDS = /\b(recruiter|talent|manager|engineer|partner|director|coordinator|sourcer|specialist|analyst|developer|designer|consultant|advisor|lead|head|vp|president|officer|intern|associate)\b/i;

// A segment is location-like if it contains a comma, geographic keyword, or known patterns
const LOCATION_LIKE = /,|Area\b|Region\b|Remote\b|District\b|Province\b|County\b|Bay\b|Valley\b|Metro\b|Greater\b|United States|United Kingdom|Canada|Germany|France|Australia|India|Singapore|Netherlands/i;

/**
 * Extract the profile's actual location from a LinkedIn snippet.
 *
 * LinkedIn snippets contain the person's location as one of the
 * separator-delimited segments. Scans ALL segments and picks the one
 * that looks like a place, not a job title or boilerplate.
 *
 * Handles LinkedIn's separator variants: · (U+00B7), • (U+2022), | (pipe)
 *
 * e.g. "View Anam's profile ... Berlin, Germany · Senior Talent Partner at ..."
 *   → "Berlin, Germany"
 * e.g. "Greater Austin Area · 500+ connections · Senior Recruiter at Dell"
 *   → "Greater Austin Area"
 */
export function extractLinkedInLocation(snippet: string): string | null {
  // Normalise LinkedIn's various separator characters to a single split char
  // U+00B7 middle dot, U+2022 bullet, U+2027 hyphenation point, pipe
  const normalised = snippet.replace(/[·•\u2027|]/g, "§");
  const segments = normalised.split("§").map(s => s.trim());

  const candidates: string[] = [];

  for (const seg of segments) {
    if (seg.length < 3 || seg.length > 60) continue;
    if (seg.includes(":")) continue;                  // "Experience: Cisco", "Education: ..."
    if (JUNK_LOCATION_WORDS.test(seg)) continue;
    if (ROLE_WORDS.test(seg)) continue;              // job title segment
    if (/\d{3,}/.test(seg)) continue;               // "500+ connections", zip codes
    if (/\bat\b|\bfor\b|\bwith\b/i.test(seg)) continue; // "Recruiter at Dell"
    if (/linkedin|profile|connection|follow|view\b/i.test(seg)) continue;
    if (!/^[A-Z]/.test(seg)) continue;              // must start with capital
    // Must look like a location — contain comma, geographic keyword, or "Remote"
    if (!LOCATION_LIKE.test(seg)) continue;
    candidates.push(seg);
  }

  if (candidates.length === 0) {
    return extractLocation(snippet);
  }

  // Prefer a candidate that contains a country name or a comma (city, country/state)
  // — these are more specific and less likely to be a company's HQ region.
  // Fallback: last candidate (personal info tends to appear later in Google snippets
  // when company description pushes region text like "San Francisco Bay Area" to the front).
  const specific = candidates.find(c => /,/.test(c));
  return specific ?? candidates[candidates.length - 1];
}

export function extractLocation(text: string): string | null {
  for (const rx of LOCATION_PATTERNS) {
    const m = text.match(rx);
    if (m) {
      const loc = (m[1] ?? "").trim();
      if (
        loc.length >= 3 &&
        loc.length <= 60 &&
        !loc.includes(":") &&
        !JUNK_LOCATION_WORDS.test(loc) &&
        !ROLE_WORDS.test(loc)
      ) {
        return loc;
      }
    }
  }
  return null;
}

// ─── LinkedIn profile parser ─────────────────────────────────────────────────────

/**
 * Google indexes LinkedIn profiles in several title formats:
 *   "Name - Title at Company | LinkedIn"          ← most common
 *   "Name - Title · Company | LinkedIn"           ← middle-dot variant
 *   "Name - Company Name | LinkedIn"              ← no explicit title
 *   "Name | LinkedIn"                             ← name only
 *
 * Try each format in order, fall back to snippet parsing.
 */
export function parseLinkedInResult(
  result: SearchResult,
  companyName: string
): ParsedLead | null {
  if (!result.url.includes("linkedin.com/in/")) return null;

  let rawName: string | null = null;
  let rawTitle: string | null = null;
  let rawCompany: string | null = null;

  // Format 1: "Name - Title at Company | LinkedIn"  (standard)
  // Format 1b: "Name – Title at Company, City | LinkedIn"
  const m1 = result.title.match(
    /^([A-Z][A-Za-z'()\-.\s]{1,50}?)\s*[–\-]\s*(.{4,80}?)\s+(?:at|@)\s+([^|,·•]{3,55}?)(?:,\s*[^|]+?)?\s*[|·]/
  );
  if (m1) {
    [, rawName, rawTitle, rawCompany] = m1;
  }

  // Format 2: "Name - Title · Company | LinkedIn"  (middle dot separator)
  if (!rawName) {
    const m2 = result.title.match(
      /^([A-Z][A-Za-z'()\-.\s]{1,50}?)\s*[–\-]\s*(.{4,80}?)\s*[·•]\s*([^|,]{3,55}?)\s*\|/
    );
    if (m2) {
      [, rawName, rawTitle, rawCompany] = m2;
    }
  }

  // Format 3: "Name - Company | LinkedIn"  (no title in heading — get title from snippet)
  if (!rawName) {
    const m3 = result.title.match(
      /^([A-Z][A-Za-z'()\-.\s]{1,50}?)\s*[–\-]\s*([^|·•]{3,55}?)\s*\|/
    );
    if (m3) {
      rawName = m3[1];
      rawCompany = m3[2];
      // Title must come from snippet
      const snippetTitle = result.snippet.match(
        /\b((?:senior |lead |principal |staff )?(?:technical recruiter|talent acquisition[a-z\s]*|recruiter|sourcer|staffing[a-z\s]*))/i
      );
      rawTitle = snippetTitle?.[1] ?? null;
    }
  }

  if (!rawName) return null;
  if (!isLikelyPersonName(rawName, companyName)) return null;

  // Reject if the parsed company/title field looks like a certification
  // e.g. "Name - Google Cloud Certified | LinkedIn" → rawCompany = "Google Cloud Certified"
  if (rawCompany && looksLikeCertification(rawCompany)) return null;
  if (rawTitle && looksLikeCertification(rawTitle)) return null;

  // Reject former employees — "Former Recruiter at Acme", "Previously at Acme", etc.
  if (looksLikeFormerEmployee(result.title, result.snippet, companyName)) return null;

  // Verify company match
  // The LinkedIn headline always shows the CURRENT employer. If we successfully
  // parsed a company from the headline and it doesn't match the target, the person
  // currently works somewhere else — reject immediately (most reliable former-employee signal).
  // Only fall back to snippet-based check when no company was parsed from the headline.
  const companyToCheck = rawCompany ?? "";
  const titleCompanyMatch = companyToCheck ? fuzzyCompanyMatch(companyToCheck.trim(), companyName) : false;
  if (companyToCheck && !titleCompanyMatch) return null;
  if (!companyToCheck && !companyInEmploymentContext(result.snippet, companyName)) return null;

  // Title classification
  const titleClass = classifyTitle((rawTitle ?? "").trim());
  if (titleClass === "noise") return null;

  // If title is unknown AND no company match in snippet, skip — too ambiguous
  if (titleClass === "unknown" && !rawTitle) return null;

  // For LinkedIn profiles, ONLY use the segment-based extractor.
  // Do NOT fall back to general pattern matching on the snippet body —
  // the snippet body often contains the job's location (from the search query)
  // which would overwrite the recruiter's actual location.
  const location = sanitiseLocation(extractLinkedInLocation(result.snippet));

  const emailMatch = result.snippet.match(/\b[\w.+%-]{2,30}@[\w.-]+\.[a-z]{2,}\b/i);
  const email = emailMatch?.[0]?.toLowerCase() ?? null;

  const jobTitle = rawTitle?.trim() || "Recruiter / Talent Acquisition";

  return {
    full_name: rawName.trim(),
    job_title: jobTitle,
    company: (rawCompany ?? companyName).trim(),
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
  if (!isLikelyPersonName(rawName, companyName)) return null;
  if (!fuzzyCompanyMatch(rawCompany.trim(), companyName)) return null;

  // Try to extract job title from snippet
  const titleInSnippet = result.snippet.match(
    /\b((?:technical |senior |lead |principal |staff )?(?:recruiter|talent acquisition|sourcer|hiring manager|staffing)[A-Za-z\s]{0,30})/i
  );
  const jobTitle = titleInSnippet?.[1]?.trim() ?? "Talent Acquisition";

  const titleClass = classifyTitle(jobTitle);
  if (titleClass === "noise") return null;

  const location = sanitiseLocation(extractLocation(result.snippet));
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
  return results.filter((r) => {
    const text = `${r.title} ${r.snippet}`.toLowerCase();

    if (!hasCompanyMention(`${r.title} ${r.snippet}`, companyName)) return false;

    const isProfileURL =
      r.url.includes("linkedin.com/in/") ||
      r.url.includes("apollo.io") ||
      r.url.includes("rocketreach.co");

    const recruiterSignal = hasRecruiterSignal(text);
    if (isProfileURL && hasNoiseSignal(text) && !recruiterSignal) return false;

    return recruiterSignal || (isProfileURL && companyInEmploymentContext(text, companyName));
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
    if (normText(lead.full_name) === normText(lead.company)) continue;

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

  // Location match — tiered (exact city > metro > state > different > unknown)
  const tiers = buildLocationTiers(input.location);
  const tierScore = locationTierScore(lead.location, tiers);
  if (tierScore === 0) score += 20;       // exact city / token match
  else if (tierScore === 1) score += 15;  // metro / regional alias
  else if (tierScore === 2) score += 8;   // same state
  else if (tierScore === 3 && lead.location) score += 2; // different region but has location
  else score -= 3;                        // no location at all

  // Verified source
  if (lead.linkedin_url) score += 10;
  if (lead.email) score += 5;
  if (lead.email_type === "verified") score += 3;

  return score;
}

// ─── Location sanitiser ────────────────────────────────────────────────────────

/**
 * Final guard: reject anything that doesn't look like a real location.
 * Applied to both AI-returned and extracted locations before storage.
 */
export function sanitiseLocation(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const loc = raw.trim();
  if (loc.length < 3 || loc.length > 60) return null;
  if (loc.includes(":")) return null;               // "Experience: Cisco"
  if (JUNK_LOCATION_WORDS.test(loc)) return null;
  if (ROLE_WORDS.test(loc)) return null;
  if (/\d{4,}/.test(loc)) return null;              // year or zip code
  if (!LOCATION_LIKE.test(loc) && !/^[A-Z][a-z]/.test(loc)) return null;
  return loc;
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
  const { company_name, location } = input;

  const tiers = buildLocationTiers(location);
  const tierScore = locationTierScore(lead.location, tiers);
  const sharedLocation = tierScore <= 1; // exact city OR same metro

  if (sharedLocation && lead.location) {
    // Location match — mention the shared location as the connection point
    return `Hi ${firstName}, I came across your profile while exploring opportunities at ${company_name} and noticed we're both based in ${lead.location}. I'm really interested in what ${company_name} is building and would love to connect with someone on the team. Would you be open to a quick conversation?`;
  } else {
    // No location match — keep it general, no location mention
    return `Hi ${firstName}, I came across your profile while exploring opportunities at ${company_name} and wanted to reach out. I'm genuinely excited about what ${company_name} is working on and would love to connect with someone on the talent team. Would you be open to a quick chat?`;
  }
}
