/**
 * Shared AI query-generation helper.
 * Calls whatever AI provider is active to produce targeted search queries.
 * Separated from providers so each provider only needs its HTTP boilerplate.
 */

import type { RecruiterSearchInput, SearchQueriesResponse } from "@/types/ai";
import { SearchQueriesResponseSchema } from "@/types/ai";
import {
  buildQueryGenerationPrompt,
  buildQueryGenSystemPrompt,
} from "./prompt";
import { extractJsonFromText } from "@/lib/utils";

/**
 * Calls the AI and returns parsed SearchQueriesResponse.
 * `callAI` is a thin wrapper supplied by each provider that handles auth + model.
 */
export async function generateSearchQueries(
  input: RecruiterSearchInput,
  callAI: (system: string, user: string) => Promise<string>
): Promise<SearchQueriesResponse> {
  const system = buildQueryGenSystemPrompt();
  const user = buildQueryGenerationPrompt(input);

  const rawText = await callAI(system, user);
  const jsonString = extractJsonFromText(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error(
      `[QueryGenerator] AI did not return valid JSON for query generation.\nRaw: ${rawText.slice(0, 300)}`
    );
  }

  const result = SearchQueriesResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `[QueryGenerator] Query response schema mismatch: ${result.error.message}`
    );
  }

  return result.data;
}
