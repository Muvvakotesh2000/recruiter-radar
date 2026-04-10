/**
 * xAI (Grok) provider.
 * xAI's API is OpenAI-compatible — raw fetch, no SDK needed.
 */

import type {
  AIProvider,
  RecruiterSearchInput,
  RecruiterLeadResponse,
  SearchQueriesResponse,
} from "@/types/ai";
import { RecruiterLeadResponseSchema } from "@/types/ai";
import {
  buildExtractionPrompt,
  buildExtractionSystemPrompt,
  buildRecruiterPrompt,
  buildSystemPrompt,
} from "../prompt";
import { generateSearchQueries } from "../query-generator";
import { extractJsonFromText } from "@/lib/utils";
import type { SearchResult } from "@/lib/search/base";

export class XAIProvider implements AIProvider {
  readonly providerName = "xai";
  readonly modelName: string;

  private readonly apiKey: string;
  private readonly baseUrl = "https://api.x.ai/v1";

  constructor() {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error("[XAIProvider] XAI_API_KEY is not set.");
    }
    this.apiKey = apiKey;
    this.modelName = process.env.XAI_MODEL?.trim() || "grok-2-1212";
  }

  /** Low-level: call the chat completions endpoint and return raw text. */
  private async call(system: string, user: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(
        `[XAIProvider] API error (${response.status}) with model '${this.modelName}': ${err}`
      );
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("[XAIProvider] Empty response from API.");
    return content;
  }

  /** Phase 1: generate search queries */
  async generateQueries(
    input: RecruiterSearchInput
  ): Promise<SearchQueriesResponse> {
    return generateSearchQueries(input, (sys, usr) => this.call(sys, usr));
  }

  /** Phase 2: extract contacts from real search results */
  async extractContacts(
    input: RecruiterSearchInput,
    searchResults: SearchResult[],
    hunterData?: import("@/lib/services/hunter").HunterResult | null,
    jobPageContent?: string | null
  ): Promise<RecruiterLeadResponse> {
    const system = buildExtractionSystemPrompt();
    const user = buildExtractionPrompt(input, searchResults, hunterData, jobPageContent);
    const raw = await this.call(system, user);
    const json = extractJsonFromText(raw);
    return RecruiterLeadResponseSchema.parse(JSON.parse(json));
  }

  /** Fallback single-shot mode (no web search — kept for compatibility) */
  async generateRecruiterLeads(
    input: RecruiterSearchInput
  ): Promise<RecruiterLeadResponse> {
    const raw = await this.call(buildSystemPrompt(), buildRecruiterPrompt(input));
    const json = extractJsonFromText(raw);
    return RecruiterLeadResponseSchema.parse(JSON.parse(json));
  }
}
