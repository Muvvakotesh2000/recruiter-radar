/**
 * Core generation service — location-first, AI-minimal pipeline.
 *
 * Phase 1  — Build dynamic location+role-aware queries (no AI)
 * Phase 2  — Execute searches in parallel + optional Hunter.io
 * Phase 2.5 — Pre-filter by signal (company + recruiter keyword)
 * Phase 3  — Non-AI extraction from LinkedIn/contact-DB snippets
 * Phase 3.5 — AI fallback only when < MIN_LEADS_WITHOUT_AI high-confidence leads
 * Phase 4  — Deduplicate, score, rank, fill emails, persist
 */

import { createClient } from "@/lib/supabase/server";
import { getAIProvider } from "@/lib/ai/factory";
import { getSearchProvider } from "@/lib/search/factory";
import { hunterDomainSearch, extractCompanyDomain } from "@/lib/services/hunter";
import { applyPattern, splitName } from "@/lib/utils/email-patterns";
import type { SearchQueriesResponse as SQR } from "@/types/ai";
import {
  filterResultsBySignal,
  extractWithoutAI,
  deduplicateLeads,
  scoreLead,
  generateOutreachMessage,
  type ParsedLead,
} from "@/lib/services/recruiter-extractor";
import type { RecruiterSearchInput } from "@/types/ai";
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

/** Max queries to execute in parallel. */
const MAX_QUERIES = 4;

/** Max results per query from Serper. */
const RESULTS_PER_QUERY = 10;

/**
 * If non-AI parsing yields at least this many High-confidence leads,
 * skip the AI extraction call entirely (saves tokens + cost).
 */
const MIN_LEADS_WITHOUT_AI = 3;

/**
 * Max results forwarded to the AI fallback.
 * Sorted by signal quality before slicing.
 */
const MAX_AI_RESULTS = 20;

export async function runGeneration(
  options: GenerationOptions
): Promise<GenerationResult> {
  const { userId, jobId, input } = options;

  const supabase = await createClient();
  const db = supabase as any;

  const aiProvider = await getAIProvider();
  const searchProvider = await getSearchProvider();

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
    throw new Error(`Failed to create generation run: ${runError?.message}`);
  }

  const generationRunId = (runData as { id: string }).id;

  await db
    .from("jobs")
    .update({ status: "processing", ai_provider: aiProvider.providerName })
    .eq("id", jobId);

  let rawResponse = "";
  let queriesUsed: string[] = [];

  try {
    // ── Phase 1: Build dynamic queries ──────────────────────────────────────────
    console.log("[Generation] Phase 1 — building dynamic queries");

    let queries = buildDynamicQueries(input);

    // Recruiter hint: prepend direct profile search (highest priority)
    if (input.recruiter_hint) {
      queries = [
        {
          query: `site:linkedin.com/in "${input.recruiter_hint}" "${input.company_name}"`,
          purpose: `Direct LinkedIn search for ${input.recruiter_hint}`,
          platform: "linkedin" as const,
        },
        ...queries,
      ];
    }

    const topQueries = queries.slice(0, MAX_QUERIES);
    queriesUsed = topQueries.map((q) => q.query);

    console.log(`[Generation] Phase 1 complete — ${topQueries.length} queries`);

    // ── Phase 2: Execute searches in parallel ────────────────────────────────────
    console.log(`[Generation] Phase 2 — searching via ${searchProvider.providerName}`);

    const companyDomain = extractCompanyDomain(input.job_url, input.company_name);

    const [searchResponses, hunterData] = await Promise.all([
      Promise.all(
        topQueries.map((q) =>
          searchProvider
            .search(q.query, RESULTS_PER_QUERY)
            .catch((err) => {
              console.warn(`[Generation] Query failed: "${q.query}" — ${err.message}`);
              return null;
            })
        )
      ),
      hunterDomainSearch(companyDomain).catch(() => null) as Promise<HunterResult | null>,
    ]);

    if (hunterData?.pattern) {
      console.log(`[Generation] Hunter.io pattern="${hunterData.pattern}" for ${companyDomain}`);
    }

    // Deduplicate by URL, sort LinkedIn profiles to the top
    const seenUrls = new Set<string>();
    const rawResults: SearchResult[] = [];

    for (const resp of searchResponses) {
      if (!resp) continue;
      for (const r of resp.results) {
        if (!seenUrls.has(r.url) && r.snippet.trim().length > 0) {
          seenUrls.add(r.url);
          rawResults.push(r);
        }
      }
    }

    // Sort: LinkedIn profiles first, then contact DBs, then everything else
    rawResults.sort((a, b) => resultSignalScore(b.url) - resultSignalScore(a.url));

    console.log(`[Generation] Phase 2 complete — ${rawResults.length} raw results`);

    // ── Phase 2.5: Pre-filter by signal ──────────────────────────────────────────
    const filteredResults = filterResultsBySignal(rawResults, input.company_name);

    console.log(
      `[Generation] Pre-filter: ${rawResults.length} → ${filteredResults.length} signal-bearing results`
    );

    // ── Phase 3: Non-AI extraction ────────────────────────────────────────────────
    console.log("[Generation] Phase 3 — non-AI extraction from structured results");

    const { parsed: parsedLeads, unprocessed: unparsedResults } =
      extractWithoutAI(filteredResults, input.company_name);

    // Score + generate outreach for parsed leads
    for (const lead of parsedLeads) {
      lead.score = scoreLead(lead, input);
      lead.outreach_message = generateOutreachMessage(lead, input);
    }

    const dedupedParsed = deduplicateLeads(parsedLeads);
    const highConfidenceParsed = dedupedParsed.filter(
      (l) => l.confidence_level === "High"
    );

    console.log(
      `[Generation] Non-AI: ${dedupedParsed.length} leads (${highConfidenceParsed.length} High confidence)`
    );

    // ── Phase 3.5: AI fallback ────────────────────────────────────────────────────
    let aiLeads: ParsedLead[] = [];
    let emailPatternFromAI: string | null = null;
    let hiringTeamNotes: string | null = null;

    const shouldUseAI =
      highConfidenceParsed.length < MIN_LEADS_WITHOUT_AI && !!aiProvider.extractContacts;

    if (shouldUseAI) {
      console.log(
        `[Generation] Phase 3.5 — AI fallback (only ${highConfidenceParsed.length} high-confidence leads so far)`
      );

      // Send unparsed results first; if too few, include filtered results
      const aiInput =
        unparsedResults.length >= 5
          ? unparsedResults.slice(0, MAX_AI_RESULTS)
          : filteredResults.slice(0, MAX_AI_RESULTS);

      try {
        const aiResult = await aiProvider.extractContacts!(
          input,
          aiInput,
          hunterData ?? null
        );

        emailPatternFromAI = aiResult.email_pattern ?? null;
        hiringTeamNotes = aiResult.hiring_team_notes ?? null;

        // Convert AI leads to ParsedLead format
        aiLeads = (aiResult.recruiters ?? []).map((r) => {
          const lead: ParsedLead = {
            full_name: r.full_name,
            job_title: r.job_title ?? "Recruiter / Talent Acquisition",
            company: input.company_name,
            location: r.location ?? null,
            linkedin_url: r.linkedin_url ?? null,
            email: r.email ?? null,
            email_type: r.email_type ?? "unknown",
            source: r.source,
            confidence_level: r.confidence_level,
            score: 0,
            outreach_message: r.outreach_message ?? "",
          };
          lead.score = scoreLead(lead, input);
          return lead;
        });

        console.log(`[Generation] AI fallback extracted ${aiLeads.length} additional leads`);
      } catch (err) {
        console.warn("[Generation] AI fallback failed:", err);
      }
    } else {
      console.log("[Generation] Skipping AI — sufficient leads from non-AI extraction");
    }

    // ── Phase 4: Merge, deduplicate, rank ────────────────────────────────────────
    const mergedLeads = deduplicateLeads([...dedupedParsed, ...aiLeads]);

    // Sort by score (location match + title quality + LinkedIn presence)
    mergedLeads.sort((a, b) => b.score - a.score);

    console.log(`[Generation] Merged: ${mergedLeads.length} unique leads`);

    // ── Phase 4.5: Fill emails via Hunter or AI-detected pattern ────────────────
    let bestPattern: string | null = null;
    let patternSource = "none";

    if (hunterData?.pattern) {
      bestPattern = hunterData.pattern;
      patternSource = "hunter";
    } else if (emailPatternFromAI) {
      const aiPat = emailPatternFromAI.replace(/@.*$/, "").trim();
      if (aiPat && aiPat.includes("{")) {
        bestPattern = aiPat;
        patternSource = "ai-detected";
      }
    }

    if (bestPattern) {
      console.log(`[Generation] Applying email pattern="${bestPattern}" (source: ${patternSource})`);
    }

    // Hunter direct-email map (exact person lookup)
    const hunterEmailMap = new Map<string, string>();
    if (hunterData?.emails) {
      for (const e of hunterData.emails) {
        if (e.first_name && e.last_name) {
          hunterEmailMap.set(
            `${e.first_name.toLowerCase()} ${e.last_name.toLowerCase()}`,
            e.email
          );
        }
      }
    }

    // Apply emails + fix titles
    const finalLeads = mergedLeads.map((lead) => {
      // Fix title: if it accidentally matches the job title, reset to generic
      const titleLower = lead.job_title.toLowerCase().trim();
      const jobTitleLower = input.job_title.toLowerCase().trim();
      if (titleLower === jobTitleLower || titleLower.length === 0) {
        lead = { ...lead, job_title: "Recruiter / Talent Acquisition" };
      }

      // Skip if already has a verified email
      if (lead.email && lead.email_type === "verified") return lead;

      const { first, last } = splitName(lead.full_name);
      if (!first || !last) return lead;

      // 1. Hunter direct match
      const hunterEmail = hunterEmailMap.get(`${first.toLowerCase()} ${last.toLowerCase()}`);
      if (hunterEmail) {
        return { ...lead, email: hunterEmail, email_type: "verified" as const };
      }

      // 2. Pattern estimation
      if (bestPattern) {
        const estimated = applyPattern(bestPattern, first, last, companyDomain);
        if (estimated) {
          return { ...lead, email: estimated, email_type: "estimated" as const };
        }
      }

      return { ...lead, email: null, email_type: "unknown" as const };
    });

    rawResponse = JSON.stringify({
      queries: queriesUsed,
      result_count: filteredResults.length,
      ai_used: shouldUseAI,
      leads_parsed: dedupedParsed.length,
      leads_from_ai: aiLeads.length,
      total: finalLeads.length,
    });

    // ── Phase 5: Persist to database ─────────────────────────────────────────────
    await db.from("recruiter_leads").delete().eq("job_id", jobId);

    if (finalLeads.length > 0) {
      const leadsToInsert = finalLeads.map((r) => ({
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
        throw new Error(`Failed to insert recruiter leads: ${leadsError.message}`);
      }
    }

    // Determine final email pattern for display
    const displayEmailPattern =
      bestPattern ? `${bestPattern}@${companyDomain}` : (emailPatternFromAI ?? null);

    await db
      .from("jobs")
      .update({
        status: "completed",
        email_pattern: displayEmailPattern,
        hiring_team_notes: hiringTeamNotes ?? null,
      })
      .eq("id", jobId);

    await db
      .from("generation_runs")
      .update({ status: "completed", raw_response: rawResponse })
      .eq("id", generationRunId);

    console.log(`[Generation] Done — ${finalLeads.length} leads saved`);

    return { recruiterCount: finalLeads.length, generationRunId, queriesUsed };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[Generation] Error:", errorMessage);

    await db.from("jobs").update({ status: "failed" }).eq("id", jobId);
    await db
      .from("generation_runs")
      .update({ status: "failed", error_message: errorMessage, raw_response: rawResponse || null })
      .eq("id", generationRunId);

    throw error;
  }
}

// ─── Signal scoring for sort order ─────────────────────────────────────────────

function resultSignalScore(url: string): number {
  if (url.includes("linkedin.com/in/")) return 4;
  if (url.includes("apollo.io") || url.includes("rocketreach.co")) return 3;
  if (url.includes("linkedin.com")) return 2;
  return 0;
}

// ─── Dynamic query builder ─────────────────────────────────────────────────────

type SearchQuery = SQR["queries"][number];

/**
 * Build 4 targeted search queries using the job's company, role, and location.
 *
 * Strategy:
 *   Q1: Location-specific LinkedIn profiles (exact city + recruiter titles)
 *   Q2: Role/function-specific LinkedIn profiles (finds technical recruiters for this function)
 *   Q3: Contact database with location filter (Apollo/RocketReach → often has emails)
 *   Q4: Email pattern discovery (domain + recruiter context)
 *
 * For LinkedIn jobs, Q1+Q2 are replaced with more targeted LinkedIn-specific variants.
 */
function buildDynamicQueries(input: RecruiterSearchInput): SearchQuery[] {
  const { company_name, job_title, location, job_url } = input;
  const slug = company_name.toLowerCase().replace(/\s+/g, "");
  const isLinkedIn = job_url.includes("linkedin.com/jobs");

  // Parse location into city + state components
  const locations = location.split(/[\/,;]|\band\b/i).map((l) => l.trim()).filter(Boolean);
  const primaryLocation = locations[0];
  const { city, state } = parseLocationParts(primaryLocation);
  const locationStr = city ?? primaryLocation;

  // Determine the job function for role-aware queries
  const jobFunction = extractJobFunction(job_title);

  const queries: SearchQuery[] = [];

  if (isLinkedIn) {
    // LinkedIn jobs: more aggressive LinkedIn profile targeting
    queries.push({
      query: `site:linkedin.com/in "${company_name}" ("technical recruiter" OR "talent acquisition" OR "recruiter") "${locationStr}"`,
      purpose: `LinkedIn recruiter profiles in ${locationStr}`,
      platform: "linkedin",
    });
    queries.push({
      query: `site:linkedin.com/in "${company_name}" "${jobFunction ? jobFunction + " recruiter" : "talent acquisition"}" OR "technical recruiter" OR "sourcer"`,
      purpose: `LinkedIn ${jobFunction ?? "TA"} recruiter profiles`,
      platform: "linkedin",
    });
  } else {
    // Non-LinkedIn: location-anchored + role-anchored
    queries.push({
      query: `site:linkedin.com/in "${company_name}" ("recruiter" OR "talent acquisition") "${locationStr}"`,
      purpose: `LinkedIn TA profiles in ${locationStr}`,
      platform: "linkedin",
    });
    queries.push({
      query: `site:linkedin.com/in "${company_name}" "${jobFunction ? jobFunction + " recruiter" : "talent acquisition"}" OR "technical recruiter"`,
      purpose: `LinkedIn recruiter matching job function`,
      platform: "linkedin",
    });
  }

  // Contact database — often surfaces emails directly, filtered by location
  queries.push({
    query: `"${company_name}" recruiter "${locationStr}" site:apollo.io OR site:rocketreach.co`,
    purpose: `Contact database: recruiters in ${locationStr}`,
    platform: "google",
  });

  // Email pattern discovery
  queries.push({
    query: `"${company_name}" "@${slug}.com" recruiter OR "talent acquisition" "${locationStr}"`,
    purpose: "Email pattern + location-specific recruiter",
    platform: "google",
  });

  // If multiple locations, add one more query for the secondary location
  if (locations.length > 1) {
    const secondCity = parseLocationParts(locations[1]).city ?? locations[1];
    queries.push({
      query: `site:linkedin.com/in "${company_name}" ("recruiter" OR "talent acquisition") "${secondCity}"`,
      purpose: `LinkedIn TA profiles in ${secondCity}`,
      platform: "linkedin",
    });
  }

  return queries;
}

// ─── Location parsing ──────────────────────────────────────────────────────────

function parseLocationParts(location: string): { city: string | null; state: string | null } {
  const parts = location.split(",").map((p) => p.trim());
  const remoteWords = ["remote", "worldwide", "global", "anywhere"];
  const city =
    parts[0] && !remoteWords.includes(parts[0].toLowerCase()) ? parts[0] : null;
  const state = parts[1] ?? null;
  return { city, state };
}

// ─── Job function extractor ────────────────────────────────────────────────────

function extractJobFunction(jobTitle: string): string | null {
  const t = jobTitle.toLowerCase();
  if (/software|engineer|developer|swe|backend|frontend|fullstack|mobile|ios|android/.test(t))
    return "engineering";
  if (/data|ml\b|machine learning|\bai\b|analytics|scientist/.test(t)) return "data";
  if (/\bproduct\b|program manager|\bpm\b/.test(t)) return "product";
  if (/design|ux\b|ui\b/.test(t)) return "design";
  if (/sales|account executive|business development|bdr|sdr/.test(t)) return "sales";
  if (/marketing|growth|seo|content/.test(t)) return "marketing";
  if (/finance|accounting|financial/.test(t)) return "finance";
  if (/operations|\bops\b|supply chain/.test(t)) return "operations";
  if (/devops|sre\b|infrastructure|cloud|platform/.test(t)) return "infrastructure";
  if (/security|cybersecurity|infosec/.test(t)) return "security";
  return null;
}
