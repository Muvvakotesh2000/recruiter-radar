import type { RecruiterSearchInput } from "@/types/ai";
import type { SearchResult } from "@/lib/search/base";

// ─── Phase 1: Query Generation ────────────────────────────────────────────────

/**
 * Prompt that asks the AI to produce targeted search queries for finding
 * recruiter contacts. These queries will be executed by a real search engine.
 */
export function buildQueryGenerationPrompt(
  input: RecruiterSearchInput
): string {
  const { company_name, job_title, location } = input;

  return `You are a recruiting research expert. Generate targeted Google search queries to find REAL recruiter contacts currently working at "${company_name}".

INPUT:
- Company: ${company_name}
- Role: ${job_title}
- Location: ${location}

QUERY RULES:
- Every query MUST contain "${company_name}" as a quoted phrase to ensure company-specific results
- Do NOT write queries that could return recruiters from other companies or generic location-based lists
- Mix LinkedIn profile searches with email/contact database searches
- Use Google operators: site:, "quotes", OR

QUERY TYPES TO INCLUDE:
1. LinkedIn recruiter at this specific company: site:linkedin.com/in "${company_name}" "recruiter" OR "talent acquisition"
2. LinkedIn TA partner for this role: site:linkedin.com/in "${company_name}" "${job_title}" hiring
3. Email pattern discovery: "${company_name}" email format site:hunter.io OR site:apollo.io
4. Direct recruiter contact with email: "${company_name}" recruiter "@" email site:apollo.io OR site:rocketreach.co
5. Company careers/team page: site:${company_name.toLowerCase().replace(/\s+/g, "")}.com "talent" OR "recruiting" OR "careers" team
6. Email pattern + name: "${company_name}" recruiter "firstname.lastname" OR "@${company_name.toLowerCase().replace(/\s+/g, "")}.com"

Write exactly 6 queries. Return ONLY valid JSON, no markdown:
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
  searchResults: SearchResult[]
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

  return `You are a strict data extraction expert. Your job is to find REAL recruiter contacts for "${company_name}" from search results.

JOB CONTEXT:
- Company: ${company_name}
- Role: ${job_title}
- Location: ${location}
- Job URL: ${job_url}

SEARCH RESULTS (real web data):
${formattedResults}

STRICT EXTRACTION RULES — follow these exactly:

INCLUSION CRITERIA (ALL must be true to include a person):
1. Their name must appear explicitly in one of the search results above
2. The search result must explicitly mention "${company_name}" in connection to this person — not just a city or region
3. Their role must be recruiter, talent acquisition, HR, hiring manager, or people operations at "${company_name}"
4. Do NOT include someone just because they are a recruiter in ${location} — they MUST be linked to "${company_name}" specifically

REJECTION RULES (exclude immediately if any apply):
- Person is a recruiter at a different company, even if in ${location}
- Person's connection to "${company_name}" is inferred — not stated in the result
- Name appears on a generic "recruiters in ${location}" list without company confirmation
- The result is a job board listing with no named contact

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

EMAIL ESTIMATION (important):
- First, scan all results for an email pattern (e.g. first.last@company.com, fname@company.com)
- If a pattern is found, apply it to EVERY confirmed contact to generate an estimated email
- Mark those emails as email_type: "estimated" and set email_pattern in the response
- Even if no direct email is found for a person, estimate it from the pattern if one exists
- Common patterns to detect: {first}.{last}@domain, {f}{last}@domain, {first}@domain
- To apply: use the person's actual first/last name with the detected pattern format

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
      "linkedin_url": "string or null",
      "email": "string or null",
      "email_type": "verified|estimated|unknown",
      "confidence_level": "High|Medium|Low",
      "source": "exact result number and snippet text that confirmed this person works at ${company_name}",
      "outreach_message": "personalized 3-5 sentence outreach message"
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
9. Outreach messages should be short, professional, and personalized to the role.

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
