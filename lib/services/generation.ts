/**
 * Core generation service — two-phase grounded search pipeline.
 *
 * Phase 1: AI generates targeted search queries (Google/LinkedIn style)
 * Phase 2: Search provider executes those queries and returns real web snippets
 * Phase 3: AI extracts structured recruiter contacts from the real results
 * Phase 4: Persist everything to Supabase
 */

import { createClient } from "@/lib/supabase/server";
import { getAIProvider } from "@/lib/ai/factory";
import { getSearchProvider } from "@/lib/search/factory";
import { buildRecruiterPrompt, buildSystemPrompt } from "@/lib/ai/prompt";
import { hunterDomainSearch, extractCompanyDomain } from "@/lib/services/hunter";
import { detectEmailPattern } from "@/lib/services/email-detective";
import { applyPattern, splitName } from "@/lib/utils/email-patterns";
import type { RecruiterSearchInput, SearchQueriesResponse } from "@/types/ai";
import type { SearchResult } from "@/lib/search/base";
import type { HunterResult } from "@/lib/services/hunter";

interface GenerationOptions {
  userId: string;
  jobId: string;
  input: RecruiterSearchInput;
}

interface GenerationResult {
  recruiterCount: number;
  generationRunId: string;
  queriesUsed: string[];
}

/** Max queries to execute in parallel. Keeps latency under control. */
const MAX_QUERIES = 6;

/** Max results per query */
const RESULTS_PER_QUERY = 10;

export async function runGeneration(
  options: GenerationOptions
): Promise<GenerationResult> {
  const { userId, jobId, input } = options;

  const supabase = await createClient();
  const db = supabase as any;

  const aiProvider = await getAIProvider();
  const searchProvider = await getSearchProvider();

  // Create generation run record
  const { data: runData, error: runError } = await db
    .from("generation_runs")
    .insert({
      user_id: userId,
      job_id: jobId,
      ai_provider: aiProvider.providerName,
      model_name: aiProvider.modelName,
      prompt_text: `[search-pipeline] ai=${aiProvider.providerName} search=${searchProvider.providerName}`,
      status: "running",
    })
    .select("id")
    .single();

  if (runError || !runData) {
    throw new Error(
      `Failed to create generation run: ${runError?.message}`
    );
  }

  const generationRunId = (runData as { id: string }).id;

  // Mark job as processing
  await db
    .from("jobs")
    .update({ status: "processing", ai_provider: aiProvider.providerName })
    .eq("id", jobId);

  let rawResponse = "";
  let queriesUsed: string[] = [];

  try {
    // ── Phase 1: Generate search queries ──────────────────────────────────────
    console.log(
      `[Generation] Phase 1 — generating queries via ${aiProvider.providerName}`
    );

    let queryResponse: SearchQueriesResponse;

    if (aiProvider.generateQueries) {
      queryResponse = await aiProvider.generateQueries(input);
    } else {
      // Fallback: build sensible default queries without AI
      queryResponse = buildFallbackQueries(input);
    }

    // For LinkedIn job postings, inject guaranteed recruiter-finding queries at
    // the front — these are hardcoded and proven, so they replace the last AI
    // queries rather than adding extra search cost
    const isLinkedIn = input.job_url.includes("linkedin.com/jobs");
    if (isLinkedIn) {
      const liQueries = buildLinkedInRecruiterQueries(input);
      // Prepend LinkedIn-specific queries, keep total at MAX_QUERIES
      queryResponse = {
        queries: [
          ...liQueries,
          ...queryResponse.queries.filter(
            (q) => !liQueries.some((lq) => lq.query === q.query)
          ),
        ],
      };
    }

    const topQueries = queryResponse.queries.slice(0, MAX_QUERIES);
    queriesUsed = topQueries.map((q) => q.query);

    console.log(
      `[Generation] Phase 1 complete — ${topQueries.length} queries generated`
    );

    // ── Phase 2: Execute searches + email pattern detection in parallel ───────
    console.log(
      `[Generation] Phase 2 — searching via ${searchProvider.providerName}`
    );

    const companyDomain = extractCompanyDomain(input.job_url, input.company_name);

    const [searchResponses, hunterData, emailPatternResult] = await Promise.all([
      // Contact-finding searches
      Promise.all(
        topQueries.map((q) =>
          searchProvider
            .search(q.query, RESULTS_PER_QUERY)
            .catch((err) => {
              console.warn(
                `[Generation] Query failed (will skip): "${q.query}" — ${err.message}`
              );
              return null;
            })
        )
      ),
      // Hunter.io (optional, if API key is set)
      hunterDomainSearch(companyDomain).catch(() => null) as Promise<HunterResult | null>,
      // Email detective — 2 targeted searches to find the real email pattern
      detectEmailPattern(companyDomain, searchProvider).catch(() => null),
    ]);

    if (hunterData?.pattern) {
      console.log(`[Generation] Hunter.io pattern="${hunterData.pattern}" for ${companyDomain}`);
    }
    if (emailPatternResult?.confidence !== "none") {
      console.log(
        `[Generation] Email detective: pattern="${emailPatternResult?.pattern}" confidence="${emailPatternResult?.confidence}" examples=${JSON.stringify(emailPatternResult?.examples)}`
      );
    }

    // Deduplicate results by URL
    const seenUrls = new Set<string>();
    const allResults: SearchResult[] = [];

    for (const resp of searchResponses) {
      if (!resp) continue;
      for (const r of resp.results) {
        if (!seenUrls.has(r.url) && r.snippet.trim().length > 0) {
          seenUrls.add(r.url);
          allResults.push(r);
        }
      }
    }

    console.log(
      `[Generation] Phase 2 complete — ${allResults.length} unique results collected`
    );

    // ── Phase 3: Extract contacts from real results ───────────────────────────
    console.log(
      `[Generation] Phase 3 — extracting contacts via ${aiProvider.providerName}`
    );

    let extractedResult;

    // Merge Hunter data with email detective results so AI gets the full picture
    const mergedHunterData: HunterResult | null = hunterData ?? (
      emailPatternResult?.pattern && emailPatternResult.confidence !== "none"
        ? {
            pattern: emailPatternResult.pattern,
            domain: companyDomain,
            emails: emailPatternResult.examples.map((e) => ({
              email: e,
              first_name: null,
              last_name: null,
              position: null,
              confidence: 70,
              linkedin_url: null,
            })),
          }
        : null
    );

    if (allResults.length > 0 && aiProvider.extractContacts) {
      extractedResult = await aiProvider.extractContacts(input, allResults, mergedHunterData);
    } else if (mergedHunterData && mergedHunterData.emails.length > 0 && aiProvider.extractContacts) {
      // No search results but we have email data — extract from that alone
      console.log("[Generation] No search results — extracting from email detective data only");
      extractedResult = await aiProvider.extractContacts(input, [], mergedHunterData);
    } else {
      // No search results — return empty rather than hallucinating contacts
      console.warn(
        "[Generation] No search results available — returning empty leads to avoid fabrication"
      );
      extractedResult = {
        company_name: input.company_name,
        job_title: input.job_title,
        job_url: input.job_url,
        job_location: input.location,
        email_pattern: null,
        hiring_team_notes: "No search results were returned. Try regenerating or check the company name.",
        recruiters: [],
      };
    }

    rawResponse = JSON.stringify({
      queries: queriesUsed,
      result_count: allResults.length,
      extracted: extractedResult,
    });

    // ── Phase 3.5: Fill missing emails — only apply patterns with real evidence ─
    //
    // Priority order (highest confidence first):
    //   1. Hunter.io verified email (exact match for this person)
    //   2. Hunter.io confirmed pattern (has real examples)
    //   3. Email detective confirmed pattern (3+ real emails found)
    //   4. Email detective likely pattern (1-2 real emails found)
    //   5. AI-detected pattern from search snippets
    //   6. No evidence — leave email null (do NOT guess)

    // Determine the best available pattern + confidence
    let bestPattern: string | null = null;
    let patternSource = "none";

    if (hunterData?.pattern) {
      bestPattern = hunterData.pattern;
      patternSource = "hunter";
    } else if (emailPatternResult?.pattern && emailPatternResult.confidence !== "none") {
      bestPattern = emailPatternResult.pattern;
      patternSource = `detective:${emailPatternResult.confidence}`;
    } else if (extractedResult.email_pattern) {
      // AI found something in the snippets — trust it only if it looks like a real pattern
      const aiPattern = extractedResult.email_pattern.replace(/@.*$/, "").trim();
      if (aiPattern && aiPattern.includes("{")) {
        bestPattern = aiPattern;
        patternSource = "ai-detected";
      }
    }

    if (bestPattern) {
      console.log(`[Generation] Applying email pattern="${bestPattern}" (source: ${patternSource})`);
    }

    // Check if Hunter has a direct email for a specific person
    const hunterEmailMap = new Map<string, string>();
    if (hunterData?.emails) {
      for (const e of hunterData.emails) {
        if (e.first_name && e.last_name) {
          const key = `${e.first_name.toLowerCase()} ${e.last_name.toLowerCase()}`;
          hunterEmailMap.set(key, e.email);
        }
      }
    }

    // Fix recruiter titles — if the AI accidentally set the recruiter's title
    // to the advertised job title, reset it to a generic recruiter label
    extractedResult.recruiters = extractedResult.recruiters.map((r: any) => {
      const titleLower = (r.job_title ?? "").toLowerCase().trim();
      const jobTitleLower = input.job_title.toLowerCase().trim();
      if (titleLower === jobTitleLower || titleLower.length === 0) {
        return { ...r, job_title: "Recruiter / Talent Acquisition" };
      }
      return r;
    });

    extractedResult.recruiters = extractedResult.recruiters.map((r: any) => {
      if (r.email && r.email_type === "verified") return r; // keep verified emails

      const { first, last } = splitName(r.full_name ?? "");
      if (!first || !last) return r;

      // Check Hunter direct match first
      const hunterEmail = hunterEmailMap.get(`${first.toLowerCase()} ${last.toLowerCase()}`);
      if (hunterEmail) {
        return { ...r, email: hunterEmail, email_type: "verified" };
      }

      // Apply confirmed/likely pattern
      if (bestPattern) {
        const estimated = applyPattern(bestPattern, first, last, companyDomain);
        if (estimated) {
          return { ...r, email: estimated, email_type: "estimated" };
        }
      }

      // No evidence — don't guess
      return { ...r, email: null, email_type: "unknown" };
    });

    // Store the pattern we used so it shows in the UI
    if (bestPattern && !extractedResult.email_pattern) {
      extractedResult = {
        ...extractedResult,
        email_pattern: `${bestPattern}@${companyDomain}`,
      };
    }

    // ── Phase 4: Persist to database ─────────────────────────────────────────
    // Delete any existing leads for this job (supports regeneration)
    await db.from("recruiter_leads").delete().eq("job_id", jobId);

    // Only save High and Medium confidence leads — Low confidence are unreliable
    const reliableLeads = extractedResult.recruiters.filter(
      (r: any) => r.confidence_level === "High" || r.confidence_level === "Medium"
    );

    if (reliableLeads.length > 0) {
      const leadsToInsert = reliableLeads.map((r: any) => ({
        job_id: jobId,
        user_id: userId,
        full_name: r.full_name,
        recruiter_title: r.job_title,
        location: r.location ?? null,
        linkedin_url: r.linkedin_url ?? null,
        email: r.email ?? null,
        email_type: r.email_type,
        confidence_level: r.confidence_level,
        source: r.source,
        outreach_message: r.outreach_message,
      }));

      const { error: leadsError } = await db
        .from("recruiter_leads")
        .insert(leadsToInsert);

      if (leadsError) {
        throw new Error(
          `Failed to insert recruiter leads: ${leadsError.message}`
        );
      }
    }

    // Update job with metadata + completed status
    await db
      .from("jobs")
      .update({
        status: "completed",
        email_pattern: extractedResult.email_pattern ?? null,
        hiring_team_notes: extractedResult.hiring_team_notes ?? null,
      })
      .eq("id", jobId);

    // Update generation run with queries and result
    await db
      .from("generation_runs")
      .update({
        status: "completed",
        raw_response: rawResponse,
      })
      .eq("id", generationRunId);

    console.log(
      `[Generation] Done — ${reliableLeads.length} reliable leads saved (${extractedResult.recruiters.length} total extracted)`
    );

    return {
      recruiterCount: reliableLeads.length,
      generationRunId,
      queriesUsed,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    console.error("[Generation] Error:", errorMessage);

    await db
      .from("jobs")
      .update({ status: "failed" })
      .eq("id", jobId);

    await db
      .from("generation_runs")
      .update({
        status: "failed",
        error_message: errorMessage,
        raw_response: rawResponse || null,
      })
      .eq("id", generationRunId);

    throw error;
  }
}

// ─── LinkedIn-specific recruiter query builder ────────────────────────────────

/**
 * Hardcoded, proven search queries for finding the recruiter who posted a
 * LinkedIn job. These bypass AI generation for this specific case and are
 * prepended to the query list so they run first.
 *
 * Strategy: search LinkedIn profiles directly for company TA/recruiter staff.
 * Google indexes public LinkedIn profiles and their headlines, so these queries
 * reliably surface recruiter profiles at the target company.
 */
function buildLinkedInRecruiterQueries(input: RecruiterSearchInput): import("@/types/ai").SearchQueriesResponse["queries"] {
  const { company_name, job_title, location } = input;

  const locations = location.split(/[\/,;]|\band\b/i).map((l) => l.trim()).filter(Boolean);
  const primaryLocation = locations[0];

  return [
    {
      // Most reliable: find TA/recruiter profiles at the company with the job title
      query: `site:linkedin.com/in "${company_name}" "talent acquisition" OR "technical recruiter" OR "recruiter" "${job_title}"`,
      purpose: "LinkedIn recruiter profile matching job title",
      platform: "linkedin" as const,
    },
    {
      // Location-anchored: find TA staff in the job's city
      query: `site:linkedin.com/in "${company_name}" "talent acquisition" OR "recruiter" "${primaryLocation}"`,
      purpose: "LinkedIn TA profiles in job location",
      platform: "linkedin" as const,
    },
    {
      // Broader: any recruiter/HR at this company (no location filter)
      query: `site:linkedin.com/in "${company_name}" "recruiter" OR "talent acquisition" OR "hiring" -jobs -job-posting`,
      purpose: "All LinkedIn recruiter profiles at company",
      platform: "linkedin" as const,
    },
  ];
}

// ─── Fallback query builder ────────────────────────────────────────────────────

import type { SearchQueriesResponse as SQR } from "@/types/ai";

function buildFallbackQueries(input: RecruiterSearchInput): SQR {
  const { company_name, job_title, location } = input;
  const slug = company_name.toLowerCase().replace(/\s+/g, "");

  return {
    queries: [
      {
        query: `site:linkedin.com/in "${company_name}" recruiter "${job_title}"`,
        purpose: "LinkedIn recruiter profiles",
        platform: "linkedin" as const,
      },
      {
        query: `site:linkedin.com/in "${company_name}" "talent acquisition" "${location}"`,
        purpose: "LinkedIn TA profiles by location",
        platform: "linkedin" as const,
      },
      {
        query: `"${company_name}" recruiter email site:apollo.io OR site:rocketreach.co`,
        purpose: "Contact database lookup",
        platform: "google" as const,
      },
      {
        query: `"${company_name}" email format "@${slug}.com" recruiter`,
        purpose: "Email pattern discovery",
        platform: "google" as const,
      },
      {
        query: `"${company_name}" "talent acquisition" hiring "${job_title}" site:linkedin.com`,
        purpose: "Role-specific TA search",
        platform: "google" as const,
      },
    ],
  };
}
