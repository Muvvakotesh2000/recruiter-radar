/**
 * Hunter.io Domain Search integration.
 * Returns the company email pattern and any known recruiter emails.
 * Free plan: 25 searches/month. Set HUNTER_API_KEY in env to enable.
 */

export interface HunterEmail {
  email: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  confidence: number;
  linkedin_url: string | null;
}

export interface HunterResult {
  pattern: string | null;       // e.g. "{first}.{last}"
  domain: string;
  emails: HunterEmail[];        // verified emails from Hunter's database
}

// Known ATS / job board domains — extract company domain from company name instead
const ATS_DOMAINS = new Set([
  // Generic job boards
  "linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com",
  "monster.com", "careerbuilder.com", "dice.com", "simplyhired.com",
  // Modern ATS
  "greenhouse.io", "lever.co", "ashbyhq.com", "rippling.com",
  "recruitee.com", "workable.com", "jazz.co", "applytojob.com",
  "hiringthing.com", "breezy.hr", "pinpoint.com", "dover.com",
  "occupop.com", "teamtailor.com", "recruitcrm.io",
  // Enterprise ATS
  "workday.com", "myworkdayjobs.com", "wd1.myworkdayjobs.com",
  "smartrecruiters.com", "jobvite.com", "icims.com",
  "taleo.net", "successfactors.com", "sapsuccessfactors.com",
  "brassring.com", "bamboohr.com", "oraclecloud.com",
  "fa.us2.oraclecloud.com", "ultipro.com", "adp.com",
  "silkroad.com", "cornerstoneondemand.com", "kenexa.com",
  "paylocity.com", "paycom.com", "kronos.com", "dayforce.com",
  "ceridian.com", "sap.com", "oracle.com",
  // Agency / RPO sites
  "myworkday.com", "careers-page.com", "jobscore.com",
  "jobsoid.com", "freshteam.com", "zohorecruit.com",
]);

/**
 * Extract the most likely company email domain from a job URL.
 * Falls back to slugifying the company name if the URL is an ATS.
 */
export function extractCompanyDomain(jobUrl: string, companyName: string): string {
  try {
    const { hostname } = new URL(jobUrl);
    const host = hostname.replace(/^www\./, "");
    const parts = host.split(".");

    // Check root domain AND any suffix combo (catches e.g. oraclecloud.com inside hdpc.fa.us2.oraclecloud.com)
    const isAts = parts.some((_, i) => {
      const suffix = parts.slice(i).join(".");
      return ATS_DOMAINS.has(suffix);
    });

    if (!isAts) {
      // Return root domain (last 2 parts), e.g. "goldmansachs.com"
      return parts.slice(-2).join(".");
    }
  } catch {
    // invalid URL — fall through
  }

  // Fallback: slugify company name → goldmansachs.com, bankofamerica.com, etc.
  return companyName.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
}

/**
 * Apply a Hunter pattern to a person's name to generate an estimated email.
 * Patterns: {first}.{last}, {f}{last}, {first}{l}, {first}, {last}
 */
export function applyEmailPattern(
  pattern: string,
  firstName: string,
  lastName: string,
  domain: string
): string {
  const f = firstName.toLowerCase().trim();
  const l = lastName.toLowerCase().trim();

  const email = pattern
    .replace("{first}", f)
    .replace("{last}", l)
    .replace("{f}", f.charAt(0))
    .replace("{l}", l.charAt(0));

  return `${email}@${domain}`;
}

/**
 * Call Hunter.io Domain Search API.
 * Returns null if HUNTER_API_KEY is not set or request fails.
 */
export async function hunterDomainSearch(domain: string): Promise<HunterResult | null> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) {
    console.warn("[Hunter] HUNTER_API_KEY not set — skipping email lookup");
    return null;
  }

  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=20&api_key=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 0 } });

    if (!res.ok) {
      console.warn(`[Hunter] Domain search failed (${res.status})`);
      return null;
    }

    const json = await res.json();
    const data = json?.data;
    if (!data) return null;

    return {
      pattern: data.pattern ?? null,
      domain,
      emails: (data.emails ?? []).map((e: Record<string, unknown>) => ({
        email: e.value as string,
        first_name: (e.first_name as string) ?? null,
        last_name: (e.last_name as string) ?? null,
        position: (e.position as string) ?? null,
        confidence: (e.confidence as number) ?? 0,
        linkedin_url: (e.linkedin as string) ?? null,
      })),
    };
  } catch (err) {
    console.warn("[Hunter] Request error:", err);
    return null;
  }
}

/**
 * Filter Hunter results to recruiter-relevant contacts only.
 */
export function filterRecruiterEmails(emails: HunterEmail[]): HunterEmail[] {
  const RECRUITER_KEYWORDS = [
    "recruiter", "talent", "hiring", "hr ", "human resources",
    "people", "acquisition", "staffing", "workforce",
  ];

  return emails.filter((e) => {
    const pos = (e.position ?? "").toLowerCase();
    return (
      e.confidence >= 70 &&
      RECRUITER_KEYWORDS.some((kw) => pos.includes(kw))
    );
  });
}
