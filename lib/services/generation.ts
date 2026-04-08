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
import type { RecruiterSearchInput, SearchQueriesResponse } from "@/types/ai";
import type { SearchResult } from "@/lib/search/base";

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
const MAX_QUERIES = 5;

/** Max results per query */
const RESULTS_PER_QUERY = 7;

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

    const topQueries = queryResponse.queries.slice(0, MAX_QUERIES);
    queriesUsed = topQueries.map((q) => q.query);

    console.log(
      `[Generation] Phase 1 complete — ${topQueries.length} queries generated`
    );

    // ── Phase 2: Execute searches in parallel ─────────────────────────────────
    console.log(
      `[Generation] Phase 2 — searching via ${searchProvider.providerName}`
    );

    const searchPromises = topQueries.map((q) =>
      searchProvider
        .search(q.query, RESULTS_PER_QUERY)
        .catch((err) => {
          console.warn(
            `[Generation] Query failed (will skip): "${q.query}" — ${err.message}`
          );
          return null;
        })
    );

    const searchResponses = await Promise.all(searchPromises);

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

    if (allResults.length > 0 && aiProvider.extractContacts) {
      extractedResult = await aiProvider.extractContacts(input, allResults);
    } else {
      // No search results or provider doesn't support extraction —
      // fall back to single-shot generation
      console.warn(
        "[Generation] No search results available — falling back to single-shot AI generation"
      );
      extractedResult = await aiProvider.generateRecruiterLeads(input);
    }

    rawResponse = JSON.stringify({
      queries: queriesUsed,
      result_count: allResults.length,
      extracted: extractedResult,
    });

    // ── Phase 4: Persist to database ─────────────────────────────────────────
    // Delete any existing leads for this job (supports regeneration)
    await db.from("recruiter_leads").delete().eq("job_id", jobId);

    if (extractedResult.recruiters.length > 0) {
      const leadsToInsert = extractedResult.recruiters.map((r: any) => ({
        job_id: jobId,
        user_id: userId,
        full_name: r.full_name,
        recruiter_title: r.job_title,
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
      `[Generation] Done — ${extractedResult.recruiters.length} leads saved`
    );

    return {
      recruiterCount: extractedResult.recruiters.length,
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
