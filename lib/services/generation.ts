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
  sanitiseLocation,
  extractLinkedInLocation,
  looksLikeFormerEmployee,
  fuzzyCompanyMatch,
  companyInEmploymentContext,
  hasRecruiterSignal,
  buildLocationTiers,
  locationTierScore,
  isLikelyPersonName,
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

/**
 * Results per query. Serper charges per API call, not per result,
 * so fetching 20 instead of 10 doubles coverage at the same credit cost.
 */
const RESULTS_PER_QUERY = 20;

/**
 * If non-AI parsing yields at least this many High-confidence leads,
 * skip the AI extraction call entirely (saves tokens + cost).
 */
const MIN_LEADS_WITHOUT_AI = 3;

/**
 * Max results forwarded to the AI fallback.
 * Sorted by signal quality before slicing.
 */
const MAX_AI_RESULTS = 25;
const ENABLE_BROAD_EMPLOYEE_FALLBACK = true;

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
    //
    // "Uncertain cases" = results we know are real people but couldn't fully parse:
    //   - LinkedIn profiles (linkedin.com/in/) with non-standard title formats
    //   - Apollo/RocketReach pages that failed contact extraction
    //
    // Never send generic web pages, job boards, or company pages to AI.
    // Skip AI entirely only when non-AI found enough leads AND no uncertain cases exist.
    let aiLeads: ParsedLead[] = [];
    let emailPatternFromAI: string | null = null;
    let hiringTeamNotes: string | null = null;

    const uncertainCases = unparsedResults.filter((r) => {
      const text = `${r.title} ${r.snippet}`;
      return (
        hasRecruiterSignal(text) &&
        !looksLikeFormerEmployee(r.title, r.snippet, input.company_name) &&
        (
          r.url.includes("linkedin.com/in/") ||
          r.url.includes("apollo.io") ||
          r.url.includes("rocketreach.co")
        )
      );
    });

    const shouldUseAI =
      !!aiProvider.extractContacts &&
      uncertainCases.length > 0 &&
      highConfidenceParsed.length < MIN_LEADS_WITHOUT_AI;

    if (shouldUseAI) {
      const aiInput = uncertainCases.slice(0, MAX_AI_RESULTS);

      console.log(
        `[Generation] Phase 3.5 — AI on ${aiInput.length} uncertain results ` +
        `(${uncertainCases.length} unparseable profiles, ${highConfidenceParsed.length} High from non-AI)`
      );

      try {
        const aiResult = await aiProvider.extractContacts!(
          input,
          aiInput,
          hunterData ?? null
        );

        emailPatternFromAI = aiResult.email_pattern ?? null;
        hiringTeamNotes = aiResult.hiring_team_notes ?? null;

        aiLeads = (aiResult.recruiters ?? []).map((r) => {
          const lead: ParsedLead = {
            full_name: r.full_name,
            job_title: r.job_title ?? "Recruiter / Talent Acquisition",
            company: input.company_name,
            location: sanitiseLocation(r.location),
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

        console.log(`[Generation] AI extracted ${aiLeads.length} additional leads`);
      } catch (err) {
        console.warn("[Generation] AI fallback failed:", err);
      }
    } else {
      console.log("[Generation] Skipping AI — non-AI parsing sufficient, no uncertain cases");
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

    // ── Phase 4.7: Management fallback ───────────────────────────────────────────
    // Reuse already-paid search results only; do not increase Serper calls.
    let managementLeads: ParsedLead[] = [];

    if (finalLeads.length <= 2) {
      console.log(
        `[Generation] Phase 4.7 — only ${finalLeads.length} recruiter lead(s); checking existing results for management`
      );

      const mgmtSeenUrls = new Set<string>();
      const mgmtResults: SearchResult[] = [];
      for (const r of rawResults) {
        if (!mgmtSeenUrls.has(r.url) && r.snippet.trim().length > 0) {
          mgmtSeenUrls.add(r.url);
          mgmtResults.push(r);
        }
      }

      console.log(`[Generation] Phase 4.7 — ${mgmtResults.length} management results`);

      // Filter: must mention the company and must be a LinkedIn profile.
      const companyNorm = input.company_name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const mgmtFiltered = mgmtResults.filter((r) => {
        const text = `${r.title} ${r.snippet}`.toLowerCase();
        const textNorm = text.replace(/[^a-z0-9\s]/g, "");
        const hasCompany =
          text.includes(input.company_name.toLowerCase()) ||
          textNorm.includes(companyNorm);
        return (
          hasCompany &&
          r.url.includes("linkedin.com/in/") &&
          !hasRecruiterSignal(text) &&
          !looksLikeFormerEmployee(r.title, r.snippet, input.company_name)
        );
      });

      // Use the dedicated management parser (accepts founder/CEO/CTO/VP/etc. titles)
      const mgmtParsed: ParsedLead[] = [];
      for (const r of mgmtFiltered) {
        const lead = parseMgmtLinkedInResult(r, input.company_name);
        if (lead) {
          lead.score = scoreLead(lead, input);
          lead.outreach_message = generateOutreachMessage(lead, input);
          mgmtParsed.push(lead);
        }
      }

      managementLeads = deduplicateLeads(mgmtParsed);
      managementLeads.sort((a, b) => b.score - a.score);
      console.log(
        `[Generation] Phase 4.7 — adding ${managementLeads.length} management contact(s) as fallback`
      );
    }

    // ── Phase 4.8: Broad employee fallback ───────────────────────────────────────
    // Last resort only. Reuses already-paid search results to keep Serper usage fixed.
    let broadEmployeeLeads: ParsedLead[] = [];

    if (ENABLE_BROAD_EMPLOYEE_FALLBACK && finalLeads.length <= 2 && managementLeads.length === 0) {
      console.log("[Generation] Phase 4.8 — no management found; checking existing results for current employees");

      const broadSeenUrls = new Set<string>();
      for (const r of rawResults) {
        if (broadSeenUrls.has(r.url) || !r.snippet.trim()) continue;
        broadSeenUrls.add(r.url);
        const lead = parseAnyCurrentEmployeeResult(r, input.company_name);
        if (lead) {
          lead.score = scoreLead(lead, input);
          lead.outreach_message = generateOutreachMessage(lead, input);
          broadEmployeeLeads.push(lead);
        }
      }
      broadEmployeeLeads = deduplicateLeads(broadEmployeeLeads);
      broadEmployeeLeads.sort((a, b) => b.score - a.score);
      console.log(`[Generation] Phase 4.8 — found ${broadEmployeeLeads.length} current employee(s)`);
    }

    // Merge management fallback into final leads (after recruiter leads)
    const allLeads = managementLeads.length > 0 || broadEmployeeLeads.length > 0
      ? deduplicateLeads([...finalLeads, ...managementLeads, ...broadEmployeeLeads])
      : finalLeads;

    // Apply emails to management leads too
    const finalAllLeads = prioritizeLocationMatches(allLeads.map((lead) => {
      // Fix title: if it accidentally matches the job title, reset to generic
      const titleLower = lead.job_title.toLowerCase().trim();
      const jobTitleLower = input.job_title.toLowerCase().trim();
      if (titleLower === jobTitleLower || titleLower.length === 0) {
        lead = { ...lead, job_title: "Recruiter / Talent Acquisition" };
      }

      if (lead.email && lead.email_type === "verified") return lead;

      const { first, last } = splitName(lead.full_name);
      if (!first || !last) return lead;

      const hunterEmail = hunterEmailMap.get(`${first.toLowerCase()} ${last.toLowerCase()}`);
      if (hunterEmail) {
        return { ...lead, email: hunterEmail, email_type: "verified" as const };
      }

      if (bestPattern) {
        const estimated = applyPattern(bestPattern, first, last, companyDomain);
        if (estimated) {
          return { ...lead, email: estimated, email_type: "estimated" as const };
        }
      }

      return { ...lead, email: null, email_type: "unknown" as const };
    }), input);

    rawResponse = JSON.stringify({
      queries: queriesUsed,
      result_count: filteredResults.length,
      ai_used: shouldUseAI,
      leads_parsed: dedupedParsed.length,
      leads_from_ai: aiLeads.length,
      management_fallback: managementLeads.length,
      broad_employee_fallback: broadEmployeeLeads.length,
      total: finalAllLeads.length,
    });

    // ── Phase 5: Persist to database ─────────────────────────────────────────────
    await db.from("recruiter_leads").delete().eq("job_id", jobId);

    if (finalAllLeads.length > 0) {
      const leadsToInsert = finalAllLeads.map((r) => ({
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

    console.log(`[Generation] Done — ${finalAllLeads.length} leads saved`);

    return { recruiterCount: finalAllLeads.length, generationRunId, queriesUsed };
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

// ─── Broad current-employee parser ────────────────────────────────────────────

/**
 * Parse any LinkedIn result for a current employee at the company.
 * Used only in Phase 4.8 (last-resort fallback when no recruiters or management found).
 * Accepts any title — just requires current employment at the target company.
 */
function parseAnyCurrentEmployeeResult(
  result: SearchResult,
  companyName: string
): ParsedLead | null {
  if (!result.url.includes("linkedin.com/in/")) return null;

  // Reject former employees
  if (looksLikeFormerEmployee(result.title, result.snippet, companyName)) return null;

  let rawName: string | null = null;
  let rawTitle: string | null = null;
  let rawCompany: string | null = null;

  // Format 1: "Name - Title at Company | LinkedIn"
  const m1 = result.title.match(
    /^([A-Z][A-Za-z'()\-.\s]{1,50}?)\s*[–\-]\s*(.{4,80}?)\s+(?:at|@)\s+([^|,·•]{3,55}?)(?:,\s*[^|]+?)?\s*[|·]/
  );
  if (m1) { rawName = m1[1]; rawTitle = m1[2]; rawCompany = m1[3]; }

  // Format 2: "Name - Title · Company | LinkedIn"
  if (!rawName) {
    const m2 = result.title.match(
      /^([A-Z][A-Za-z'()\-.\s]{1,50}?)\s*[–\-]\s*(.{4,80}?)\s*[·•]\s*([^|,]{3,55}?)\s*\|/
    );
    if (m2) { rawName = m2[1]; rawTitle = m2[2]; rawCompany = m2[3]; }
  }

  // Format 3: "Name - Company | LinkedIn"
  if (!rawName) {
    const m3 = result.title.match(
      /^([A-Z][A-Za-z'()\-.\s]{1,50}?)\s*[–\-]\s*([^|·•]{3,55}?)\s*\|/
    );
    if (m3) { rawName = m3[1]; rawCompany = m3[2]; }
  }

  if (!rawName) return null;
  if (!isLikelyPersonName(rawName, companyName)) return null;

  // Strip trailing "@company" suffix from rawTitle (e.g. "Engineer @Acme" → "Engineer")
  if (rawTitle) rawTitle = rawTitle.replace(/\s*@\S+$/, "").trim() || null;

  // Headline company must match — if it doesn't, person currently works elsewhere
  if (!rawCompany || !fuzzyCompanyMatch(rawCompany.trim(), companyName)) return null;

  const location = sanitiseLocation(extractLinkedInLocation(result.snippet));
  const emailMatch = result.snippet.match(/\b[\w.+%-]{2,30}@[\w.-]+\.[a-z]{2,}\b/i);
  const email = emailMatch?.[0]?.toLowerCase() ?? null;

  return {
    full_name: rawName.trim(),
    job_title: rawTitle?.trim() || "Employee",
    company: companyName,
    location,
    linkedin_url: result.url,
    email,
    email_type: email ? "verified" : "unknown",
    source: `[broad employee fallback] ${result.url} — ${result.snippet.slice(0, 100)}`,
    confidence_level: "Low",
    score: 0,
    outreach_message: "",
  };
}

function prioritizeLocationMatches(
  leads: ParsedLead[],
  input: RecruiterSearchInput
): ParsedLead[] {
  const isRemote = /^remote$/i.test(input.location.trim()) || /\bremote\b/i.test(input.location);
  const sorted = [...leads].sort((a, b) => b.score - a.score);
  if (isRemote) return sorted;

  const tiers = buildLocationTiers(input.location);
  const exactOrNearby = sorted.filter((lead) => locationTierScore(lead.location, tiers) <= 1);
  const sameState = sorted.filter((lead) => locationTierScore(lead.location, tiers) === 2);

  if (exactOrNearby.length > 0) {
    return [...exactOrNearby, ...sameState];
  }

  if (sameState.length > 0) {
    return sameState;
  }

  return sorted;
}

// ─── Management lead parser ────────────────────────────────────────────────────

const MGMT_TITLE_RE = /\b(founder|co-?founder|chief executive officer|chief executive|ceo|chief financial officer|chief financial|cfo|chief technology officer|chief technology|cto|chief operating officer|chief operating|coo|chief product officer|chief product|cpo|chief people officer|chief people|president|vice president|vp of|head of|director of|general manager|managing director|team lead)\b/i;

/**
 * Parse a LinkedIn search result specifically for founder/leadership contacts.
 * Used only in the management fallback (Phase 4.7).
 *
 * Strict rule: the company name AND a management title must BOTH appear in the
 * same parsed LinkedIn headline segment — not just anywhere in the page text.
 * This prevents false positives where the title belongs to a different company.
 */
function parseMgmtLinkedInResult(
  result: SearchResult,
  companyName: string
): ParsedLead | null {
  if (!result.url.includes("linkedin.com/in/")) return null;

  // Reject former employees upfront
  if (looksLikeFormerEmployee(result.title, result.snippet, companyName)) return null;

  // ── Parse the LinkedIn headline (title tag) ──────────────────────────────────
  let rawName: string | null = null;
  let rawTitle: string | null = null;
  let rawCompany: string | null = null;

  // Format 1: "Name - Title at/@ Company | LinkedIn" (space-@ or word-at)
  const m1 = result.title.match(
    /^([A-Z][A-Za-z'()\-.\s]{1,50}?)\s*[–\-]\s*(.{4,80}?)\s+(?:at|@)\s+([^|,·•]{3,55}?)(?:,\s*[^|]+?)?\s*[|·]/
  );
  if (m1) { rawName = m1[1]; rawTitle = m1[2]; rawCompany = m1[3]; }

  // Format 1b: "Name - Title @Company | LinkedIn" (@ with no space before company)
  if (!rawName) {
    const m1b = result.title.match(
      /^([A-Z][A-Za-z'()\-.\s]{1,50}?)\s*[–\-]\s*(.{4,60}?)\s*@([\w][\w.\-]{2,50}?)\s*[|·,]/
    );
    if (m1b) { rawName = m1b[1]; rawTitle = m1b[2]; rawCompany = m1b[3]; }
  }

  // Format 2: "Name - Title · Company | LinkedIn"
  if (!rawName) {
    const m2 = result.title.match(
      /^([A-Z][A-Za-z'()\-.\s]{1,50}?)\s*[–\-]\s*(.{4,80}?)\s*[·•]\s*([^|,]{3,55}?)\s*\|/
    );
    if (m2) { rawName = m2[1]; rawTitle = m2[2]; rawCompany = m2[3]; }
  }

  // Format 3: "Name - Company | LinkedIn" (no title in headline — rawTitle stays null)
  if (!rawName) {
    const m3 = result.title.match(
      /^([A-Z][A-Za-z'()\-.\s]{1,50}?)\s*[–\-]\s*([^|·•]{3,55}?)\s*\|/
    );
    if (m3) { rawName = m3[1]; rawCompany = m3[2]; }
  }

  if (!rawName) return null;
  if (!isLikelyPersonName(rawName, companyName)) return null;

  // Strip trailing "@company" suffix from rawTitle (e.g. "CEO @Jobright.ai" → "CEO")
  if (rawTitle) rawTitle = rawTitle.replace(/\s*@\S+$/, "").trim() || null;

  // ── Company must match in the headline (current employer) ───────────────────
  // LinkedIn headline always shows the current employer. If the parsed company
  // doesn't match, the person works somewhere else — reject.
  // For Format 3 with no separate title field, also accept snippet employment context.
  const headlineMatch = rawCompany ? fuzzyCompanyMatch(rawCompany.trim(), companyName) : false;
  const snippetCurrentMatch =
    !headlineMatch &&
    !rawTitle && // only when Format 3 (no title parsed)
    companyInEmploymentContext(result.snippet, companyName) &&
    !looksLikeFormerEmployee(result.title, result.snippet, companyName);

  if (!headlineMatch && !snippetCurrentMatch) return null;

  // ── Title: use parsed headline title, otherwise "Management" ─────────────────
  const jobTitle = rawTitle?.trim() || "Management";
  if (rawTitle && !MGMT_TITLE_RE.test(rawTitle)) return null;
  if (!rawTitle && !MGMT_TITLE_RE.test(result.snippet)) return null;

  const location = sanitiseLocation(extractLinkedInLocation(result.snippet));
  const emailMatch = result.snippet.match(/\b[\w.+%-]{2,30}@[\w.-]+\.[a-z]{2,}\b/i);
  const email = emailMatch?.[0]?.toLowerCase() ?? null;

  return {
    full_name: rawName.trim(),
    job_title: jobTitle,
    company: companyName,
    location,
    linkedin_url: result.url,
    email,
    email_type: email ? "verified" : "unknown",
    source: `[management fallback] ${result.url} — ${result.snippet.slice(0, 100)}`,
    confidence_level: "Medium",
    score: 0,
    outreach_message: "",
  };
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
  const { company_name, job_title, location } = input;

  // Detect remote jobs — location-pinned queries don't help for fully remote roles
  const isRemote = /^remote$/i.test(location.trim()) || /\bremote\b/i.test(location);

  if (isRemote) {
    // For remote jobs, skip location filters entirely — search company-wide
    return [
      {
        query: `site:linkedin.com/in "${company_name}" ("recruiter" OR "talent acquisition" OR "technical recruiter")`,
        purpose: `LinkedIn recruiters at ${company_name} (remote role — no location filter)`,
        platform: "linkedin",
      },
      {
        query: `site:linkedin.com/in "${company_name}" ("sourcer" OR "recruiting manager" OR "talent partner")`,
        purpose: `LinkedIn technical recruiters and sourcers at ${company_name}`,
        platform: "linkedin",
      },
      {
        query: `site:linkedin.com/in "${company_name}" ("founder" OR "co-founder" OR "CEO" OR "CFO" OR "CTO" OR "COO" OR "head of" OR "director")`,
        purpose: `LinkedIn leadership at ${company_name}`,
        platform: "linkedin",
      },
      {
        query: `site:linkedin.com/in "${company_name}" -"jobs" -"careers"`,
        purpose: `LinkedIn current employees at ${company_name}`,
        platform: "linkedin",
      },
    ];
  }

  // Parse location into city + state components
  const locations = location.split(/[\/,;]|\band\b/i).map((l) => l.trim()).filter(Boolean);
  const primaryLocation = locations[0];
  const { city, state } = parseLocationParts(primaryLocation);
  const locationStr = city ?? primaryLocation;
  const locationTiers = buildLocationTiers(location);
  const nearbyTerms = [...locationTiers.tier1, ...locationTiers.tier2]
    .filter((term) => term && term.toLowerCase() !== locationStr.toLowerCase())
    .slice(0, 4);
  const localTerms = [locationStr, ...nearbyTerms].filter(Boolean).slice(0, 5);
  const localLocationQuery = localTerms.map((term) => `"${term}"`).join(" OR ");
  const stateTerms = locationTiers.tier2.length > 0
    ? locationTiers.tier2
    : ([state].filter(Boolean) as string[]);
  const stateLocationQuery = stateTerms.map((term) => `"${term}"`).join(" OR ");

  // Determine the job function for role-aware queries
  const jobFunction = extractJobFunction(job_title);
  const roleRecruiterTerm = jobFunction
    ? `${jobFunction} recruiter`
    : "technical recruiter";

  const queries: SearchQuery[] = [];

  // Q1: local recruiter profiles using exact city plus nearby metro labels.
  queries.push({
    query: `site:linkedin.com/in "${company_name}" ("recruiter" OR "talent acquisition" OR "technical recruiter" OR "sourcer") (${localLocationQuery})`,
    purpose: `LinkedIn recruiters in ${locationStr}`,
    platform: "linkedin",
  });

  // Q2: broader hiring-team titles in local/nearby/state results.
  queries.push({
    query: `site:linkedin.com/in "${company_name}" ("${roleRecruiterTerm}" OR "talent partner" OR "recruiting coordinator" OR "recruiting manager" OR "human resources" OR "people operations") (${localLocationQuery}${stateLocationQuery ? ` OR ${stateLocationQuery}` : ""})`,
    purpose: `LinkedIn recruiters near ${locationStr}`,
    platform: "linkedin",
  });

  // Q3: management fallback candidates in the same location/nearby area.
  queries.push({
    query: `site:linkedin.com/in "${company_name}" ("founder" OR "co-founder" OR "CEO" OR "CFO" OR "CTO" OR "COO" OR "head of" OR "director") (${localLocationQuery}${stateLocationQuery ? ` OR ${stateLocationQuery}` : ""})`,
    purpose: `LinkedIn leadership near ${locationStr}`,
    platform: "linkedin",
  });

  // Q4: current employees in the same location/nearby area for last-resort fallback.
  queries.push({
    query: `site:linkedin.com/in "${company_name}" (${localLocationQuery}${stateLocationQuery ? ` OR ${stateLocationQuery}` : ""}) -"jobs" -"careers"`,
    purpose: `LinkedIn current employees near ${locationStr}`,
    platform: "linkedin",
  });

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
