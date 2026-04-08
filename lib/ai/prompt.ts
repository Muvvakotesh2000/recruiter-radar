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

  return `You are a recruiting research expert specializing in finding recruiter and hiring manager contact information.

Generate highly targeted search queries to find recruiter and talent acquisition contacts at the following company.

INPUT:
- Company: ${company_name}
- Role: ${job_title}
- Location: ${location}

QUERY STRATEGY:
1. LinkedIn profile searches: find recruiters and TA partners at the company
2. Email discovery searches: find email patterns or direct contacts via Apollo, RocketReach, Hunter
3. Company careers page searches: often lists TA team contacts
4. Name + company + email searches: find direct contact details

REQUIREMENTS:
- Write 6 precise search queries
- Mix LinkedIn site-search queries with general web queries
- Use Google-dork style operators: site:, "quotes", OR
- Focus on finding real people who recruit for this role/company
- Include at least 2 queries targeting email addresses or patterns
- Vary query angles to maximize discovery

Return ONLY valid JSON, no markdown:
{
  "queries": [
    {
      "query": "exact search string to execute",
      "purpose": "brief description of what this query targets",
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

  return `You are a data extraction expert specializing in recruiter contact discovery.

Extract recruiter and hiring manager contacts from the following real web search results.

JOB CONTEXT:
- Company: ${company_name}
- Role: ${job_title}
- Location: ${location}
- Job URL: ${job_url}

SEARCH RESULTS (real web data):
${formattedResults}

EXTRACTION RULES:
1. Extract ONLY information explicitly present in the search results above
2. For LinkedIn URLs: only include if a real linkedin.com/in/ URL appears in the results
3. For emails:
   - "verified": email appears directly in a result snippet
   - "estimated": email was computed using a confirmed company email pattern
   - "unknown": email cannot be determined from these results
4. Never fabricate names, emails, or LinkedIn URLs not present in the data above
5. If a name appears but their email is unknown, still include them with email: null
6. Confidence levels:
   - High: person is explicitly identified as recruiter/TA/hiring manager at this company
   - Medium: person works at company in a relevant role but not explicitly confirmed as recruiter
   - Low: tenuous connection to this role or company
7. The outreach_message must be short (3-5 sentences), professional, personalized to the specific role and company
8. Extract 2-5 contacts maximum; quality over quantity
9. If the results contain an email pattern (e.g. {first}.{last}@company.com), use it to estimate emails for identified people
10. source: describe exactly which search result contained this person's information

Return ONLY valid JSON, no markdown or explanation:
{
  "company_name": "${company_name}",
  "job_title": "${job_title}",
  "job_url": "${job_url}",
  "job_location": "${location}",
  "email_pattern": "detected pattern or null",
  "hiring_team_notes": "observations about the TA team or hiring structure from the results, or null",
  "recruiters": [
    {
      "full_name": "string",
      "job_title": "string",
      "linkedin_url": "string or null",
      "email": "string or null",
      "email_type": "verified|estimated|unknown",
      "confidence_level": "High|Medium|Low",
      "source": "which result this came from",
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
