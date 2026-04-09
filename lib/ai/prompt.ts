import type { RecruiterSearchInput } from "@/types/ai";
import type { SearchResult } from "@/lib/search/base";
import type { HunterResult, HunterEmail } from "@/lib/services/hunter";

// ─── Phase 1: Query Generation ────────────────────────────────────────────────

/**
 * Prompt that asks the AI to produce targeted search queries for finding
 * recruiter contacts. These queries will be executed by a real search engine.
 */
export function buildQueryGenerationPrompt(
  input: RecruiterSearchInput
): string {
  const { company_name, job_title, location } = input;

  // Parse multiple locations (split by / , ; or "and")
  const locations = location
    .split(/[\/,;]|\band\b/i)
    .map((l) => l.trim())
    .filter(Boolean);

  const primaryLocation = locations[0];
  const hasMultipleLocations = locations.length > 1;
  const locationList = locations.map((l) => `"${l}"`).join(" OR ");
  const companySlug = company_name.toLowerCase().replace(/\s+/g, "");

  return `You are a recruiting research expert. Generate targeted Google search queries to find REAL recruiter contacts currently working at "${company_name}".

INPUT:
- Company: ${company_name}
- Role: ${job_title}
- Location(s): ${location}${hasMultipleLocations ? ` (multiple locations: ${locations.join(", ")})` : ""}

QUERY RULES:
- Every query MUST contain "${company_name}" as a quoted phrase — never omit it
- LOCATION PRIORITY: Prefer queries that combine "${company_name}" with specific city/location names
- Do NOT write generic queries that return recruiters across all of USA without location anchoring
- Mix LinkedIn profile searches with email/contact database searches

QUERY TYPES TO INCLUDE (write exactly 6):
1. Location-anchored LinkedIn: site:linkedin.com/in "${company_name}" "recruiter" OR "talent acquisition" ${primaryLocation}
2. ${hasMultipleLocations ? `Multi-location LinkedIn: site:linkedin.com/in "${company_name}" recruiter (${locationList})` : `Role-specific LinkedIn: site:linkedin.com/in "${company_name}" "${job_title}" recruiter`}
3. Email pattern discovery: "@${companySlug}.com" recruiter OR "talent acquisition" — finds pages exposing real email addresses
4. Apollo/RocketReach contact: site:apollo.io OR site:rocketreach.co "${company_name}" recruiter email
5. Company domain email evidence: "${company_name}" recruiter "email" "@${companySlug}.com" site:linkedin.com OR site:github.com
6. Company careers/TA team: "${company_name}" "talent acquisition" OR "recruiting team" ${primaryLocation} email contact

IMPORTANT: Queries 3, 4, and 5 are specifically designed to uncover real email addresses or confirm the company email pattern. Include all of them.

Return ONLY valid JSON, no markdown:
{
  "queries": [
    {
      "query": "exact search string to execute",
      "purpose": "brief description",
      "platform": "google" | "linkedin"
    }
  ]
}`;
}

// ─── Phase 2: Contact Extraction ──────────────────────────────────────────────

/**
 * Prompt that feeds real search results to the AI and asks it to extract
 * structured recruiter contact data. This grounds the output in real web data.
 */
export function buildExtractionPrompt(
  input: RecruiterSearchInput,
  searchResults: SearchResult[],
  hunterData?: HunterResult | null
): string {
  const { company_name, job_title, location, job_url } = input;

  const formattedResults = searchResults
    .map((r, i) =>
      `[Result ${i + 1}]
Title: ${r.title}
URL: ${r.url}
Snippet: ${r.snippet}${r.content ? `\nContent: ${r.content.slice(0, 600)}` : ""}`
    )
    .join("\n\n---\n\n");

  // Parse multiple locations
  const locations = location
    .split(/[\/,;]|\band\b/i)
    .map((l) => l.trim())
    .filter(Boolean);
  const locationDisplay = locations.length > 1
    ? `${location} (any of: ${locations.join(", ")})`
    : location;

  // Build Hunter ground-truth block
  let hunterBlock = "";
  if (hunterData) {
    const lines: string[] = [];
    lines.push(`VERIFIED EMAIL DATA FROM HUNTER.IO (treat as ground truth):`);
    lines.push(`- Company domain: ${hunterData.domain}`);

    if (hunterData.pattern) {
      lines.push(`- Confirmed email pattern: ${hunterData.pattern}@${hunterData.domain}`);
      lines.push(`  → Apply this pattern to EVERY identified person to generate their estimated email`);
    }

    const recruiterEmails = hunterData.emails.filter((e: HunterEmail) =>
      (e.position ?? "").toLowerCase().match(/recruit|talent|hr|people|hiring|acquisition/)
    );
    if (recruiterEmails.length > 0) {
      lines.push(`- Known recruiter emails (confidence ≥70%):`);
      recruiterEmails.forEach((e: HunterEmail) => {
        const name = [e.first_name, e.last_name].filter(Boolean).join(" ");
        lines.push(`  • ${name || "Unknown"} — ${e.email} — ${e.position ?? "unknown role"} (confidence: ${e.confidence}%)`);
      });
    } else if (hunterData.emails.length > 0) {
      lines.push(`- Sample verified emails at this domain (use pattern to estimate others):`);
      hunterData.emails.slice(0, 5).forEach((e: HunterEmail) => {
        lines.push(`  • ${e.email}`);
      });
    }

    hunterBlock = "\n\n" + lines.join("\n");
  }

  return `You are a strict data extraction expert. Your job is to find REAL recruiter contacts for "${company_name}" from search results.

JOB CONTEXT:
- Company: ${company_name}
- Role: ${job_title}
- Location(s): ${locationDisplay}
- Job URL: ${job_url}
${hunterBlock}

SEARCH RESULTS (real web data):
${formattedResults}

STRICT EXTRACTION RULES — follow these exactly:

INCLUSION CRITERIA (ALL must be true to include a person):
1. Their name must appear explicitly in one of the search results above
2. The search result must explicitly mention "${company_name}" in connection to this person — not just a city or region
3. Their role must be recruiter, talent acquisition, HR, hiring manager, or people operations at "${company_name}"
4. Do NOT include someone just because they are a recruiter in the location — they MUST be linked to "${company_name}" specifically

REJECTION RULES (exclude immediately if any apply):
- Person is a recruiter at a different company, even if in the same location
- Person's connection to "${company_name}" is inferred — not stated in the result
- Name appears on a generic "recruiters in [city]" list without company confirmation
- The result is a job board listing with no named contact

LOCATION PRIORITY (rank results in this order):
- Tier 1 (PREFER): Person is confirmed at "${company_name}" AND their location matches one of: ${locations.join(", ")}
- Tier 2 (INCLUDE if no Tier 1): Person is confirmed at "${company_name}" but location is unspecified or different
- Tier 3 (EXCLUDE): Person is a recruiter in the location but NOT confirmed at "${company_name}"

When you have multiple valid contacts, always list Tier 1 contacts first. If you find enough Tier 1 contacts (3+), do not include Tier 2.

DATA RULES:
- LinkedIn URLs: only include real linkedin.com/in/[username] URLs from the results — never guess or construct them
- Emails marked "verified": email text appears directly in a snippet
- Emails marked "estimated": derived from a confirmed company email pattern found in results
- Emails marked "unknown": cannot be confirmed — set email to null
- Never fabricate or guess emails, names, or URLs

CONFIDENCE LEVELS:
- High: snippet explicitly names this person as a recruiter/TA at "${company_name}"
- Medium: snippet shows they work at "${company_name}" in a people/HR role
- Low: weak or indirect connection — ONLY include if no better leads exist

EMAIL DETECTION (scan every result carefully):
- Look for ANY occurrence of "@" followed by a domain that matches "${company_name}" in snippets — even partial like "j.smith@"
- Look for phrases like "email us at", "contact:", "reach me at", "my email" followed by an address
- Look for email format hints like "our emails follow first.last@" or "firstname@company"
- If you find even ONE company email in the results, you can infer the pattern for everyone

EMAIL ESTIMATION (apply in this order):
1. Hunter.io verified email for this exact person → email_type: "verified"
2. Hunter.io confirmed pattern applied to name → email_type: "estimated"
3. Email found directly in a search result snippet → email_type: "verified"
4. Pattern inferred from any email seen in results → apply to all names → email_type: "estimated"
5. No evidence at all → set email: null, email_type: "unknown" (backend will apply first.last default)

CRITICAL: Set email_pattern in your response if you detect ANY pattern — even from a single email seen in results. Format it as "{first}.{last}" or "{f}{last}" etc. This is used to fill emails for all contacts.

OUTPUT RULES:
- Return 0 recruiters if no valid contacts found — an empty array is better than fabricated data
- Maximum 5 contacts; prefer quality over quantity

Return ONLY valid JSON, no markdown or explanation:
{
  "company_name": "${company_name}",
  "job_title": "${job_title}",
  "job_url": "${job_url}",
  "job_location": "${location}",
  "email_pattern": "detected pattern or null",
  "hiring_team_notes": "observations about the TA team structure from the results, or null",
  "recruiters": [
    {
      "full_name": "string",
      "job_title": "string",
      "location": "city, state or country if visible in results, else null",
      "linkedin_url": "string or null",
      "email": "string or null",
      "email_type": "verified|estimated|unknown",
      "confidence_level": "High|Medium|Low",
      "source": "exact result number and snippet text that confirmed this person works at ${company_name}",
      "outreach_message": "personalized outreach message following this structure: (1) mention that you applied for the ${job_title} role at ${company_name} in ${location}, (2) say that you noticed the recruiter is located in their city/region, (3) ask whether they are familiar with or involved in this role, (4) if so, ask if they can share more about the role or the team. Keep it friendly, concise (3-4 sentences), and conversational — not overly formal."
    }
  ]
}`;
}

// ─── System prompts ────────────────────────────────────────────────────────────

export function buildQueryGenSystemPrompt(): string {
  return "You are a recruiting research expert. Generate precise search queries to find recruiter contacts. Return valid JSON only. No markdown. No explanation outside the JSON.";
}

export function buildExtractionSystemPrompt(): string {
  return "You are a data extraction expert. Extract recruiter contact information strictly from the provided search results. Do not invent information. Return valid JSON only. No markdown. No explanation outside the JSON.";
}

// ─── Legacy single-shot prompt (kept as fallback) ─────────────────────────────

export function buildRecruiterPrompt(input: RecruiterSearchInput): string {
  const { company_name, job_title, job_url, location } = input;
  return `You are RecruiterRadar, an AI assistant that identifies the most relevant recruiting or hiring contacts for a job opening.

Your goal is to return the best possible recruiter or hiring-related contacts for this role, while being honest about uncertainty.

INPUT:
- Company Name: ${company_name}
- Job Title: ${job_title}
- Job Link: ${job_url}
- Job Location: ${location}

INSTRUCTIONS:
1. Identify the most relevant recruiter, talent acquisition partner, recruiting lead, hiring manager, or hiring-related contact for this role.
2. Prefer people connected to:
   - the same company
   - the same function or department
   - the same location
   - recruiting, talent acquisition, hiring, or direct team leadership
3. You may return inferred candidates if they are plausible, but you must label them conservatively using confidence_level.
4. Do NOT fabricate certainty.
5. Do NOT fabricate LinkedIn URLs or emails. If unknown, set them to null.
6. If an email is not explicitly known, set email: null and email_type: "unknown"
7. Prefer 2-5 useful contacts when possible.
8. The source field must explain why this person was selected.
9. Outreach messages must follow this structure: (1) mention that you applied for the role at the company in the job location, (2) note that you see the recruiter is based in their location, (3) ask if they are familiar with or involved in this role, (4) if so, ask if they can share more about the role or team. Keep it friendly, concise (3-4 sentences), and conversational.

Return ONLY valid JSON in this exact schema:
{
  "company_name": "string",
  "job_title": "string",
  "job_url": "string",
  "job_location": "string",
  "email_pattern": "string or null",
  "hiring_team_notes": "string or null",
  "recruiters": [
    {
      "full_name": "string",
      "job_title": "string",
      "location": "city/region or null",
      "linkedin_url": "string or null",
      "email": "string or null",
      "email_type": "verified|estimated|unknown",
      "confidence_level": "High|Medium|Low",
      "source": "string",
      "outreach_message": "string"
    }
  ]
}

Do not include any markdown or explanation outside the JSON object.`;
}

export function buildSystemPrompt(): string {
  return `You are RecruiterRadar, an assistant that suggests the most relevant recruiter or hiring-related contacts for a job.

Be honest about uncertainty.
Do not fabricate certainty, emails, or URLs.
Return useful candidates with conservative confidence labels.
Return valid JSON only.`;
}
