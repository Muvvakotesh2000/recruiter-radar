import { z } from "zod";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const RecruiterContactSchema = z.object({
  full_name: z.string().min(1),
  job_title: z.string().min(1),
  location: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  email_type: z.enum(["verified", "estimated", "unknown"]),
  confidence_level: z.enum(["High", "Medium", "Low"]),
  source: z.string().min(1),
  outreach_message: z.string().min(1),
});

export const RecruiterLeadResponseSchema = z.object({
  company_name: z.string(),
  job_title: z.string(),
  job_url: z.string(),
  job_location: z.string(),
  email_pattern: z.string().nullable().optional(),
  hiring_team_notes: z.string().nullable().optional(),
  recruiters: z.array(RecruiterContactSchema).min(0),
});

// ─── Inferred Types ────────────────────────────────────────────────────────────

export type RecruiterContact = z.infer<typeof RecruiterContactSchema>;
export type RecruiterLeadResponse = z.infer<typeof RecruiterLeadResponseSchema>;

// ─── Input Type ────────────────────────────────────────────────────────────────

export interface RecruiterSearchInput {
  company_name: string;
  job_title: string;
  job_url: string;
  location: string;
  /** Optional name hint from "Meet the Hiring Team" or job description */
  recruiter_hint?: string;
}

// ─── Provider Interface ────────────────────────────────────────────────────────

export interface AIProvider {
  readonly providerName: string;
  readonly modelName: string;

  /** Phase 1: generate targeted search queries */
  generateQueries?(input: RecruiterSearchInput): Promise<SearchQueriesResponse>;

  /** Phase 2: extract contacts from real search results */
  extractContacts?(
    input: RecruiterSearchInput,
    searchResults: import("@/lib/search/base").SearchResult[],
    hunterData?: import("@/lib/services/hunter").HunterResult | null
  ): Promise<RecruiterLeadResponse>;

  /** Legacy / fallback single-shot mode */
  generateRecruiterLeads(
    input: RecruiterSearchInput
  ): Promise<RecruiterLeadResponse>;
}

// ─── Search query generation schema ──────────────────────────────────────────

export const SearchQuerySchema = z.object({
  query: z.string().min(1),
  purpose: z.string(),
  platform: z.enum(["google", "linkedin"]),
});

export const SearchQueriesResponseSchema = z.object({
  queries: z.array(SearchQuerySchema).min(1).max(10),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type SearchQueriesResponse = z.infer<typeof SearchQueriesResponseSchema>;

// ─── Provider IDs ─────────────────────────────────────────────────────────────

export type AIProviderID = "openai";

export const AI_PROVIDER_LABELS: Record<AIProviderID, string> = {
  openai: "OpenAI (GPT-4o)",
};
