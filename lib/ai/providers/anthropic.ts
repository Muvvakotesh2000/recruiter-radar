/**
 * Anthropic (Claude) provider.
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

export class AnthropicProvider implements AIProvider {
  readonly providerName = "anthropic";
  readonly modelName: string;

  private readonly apiKey: string;
  private readonly baseUrl = "https://api.anthropic.com/v1";

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("[AnthropicProvider] ANTHROPIC_API_KEY is not set.");
    }
    this.apiKey = apiKey;
    this.modelName = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  }

  private async call(system: string, user: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.modelName,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[AnthropicProvider] API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const content = data?.content?.[0]?.text;
    if (!content) throw new Error("[AnthropicProvider] Empty response from API.");
    return content;
  }

  async generateQueries(
    input: RecruiterSearchInput
  ): Promise<SearchQueriesResponse> {
    return generateSearchQueries(input, (sys, usr) => this.call(sys, usr));
  }

  async extractContacts(
    input: RecruiterSearchInput,
    searchResults: SearchResult[],
    hunterData?: import("@/lib/services/hunter").HunterResult | null,
    jobPageContent?: string | null
  ): Promise<RecruiterLeadResponse> {
    const raw = await this.call(
      buildExtractionSystemPrompt(),
      buildExtractionPrompt(input, searchResults, hunterData, jobPageContent)
    );
    return RecruiterLeadResponseSchema.parse(JSON.parse(extractJsonFromText(raw)));
  }

  async generateRecruiterLeads(
    input: RecruiterSearchInput
  ): Promise<RecruiterLeadResponse> {
    const raw = await this.call(buildSystemPrompt(), buildRecruiterPrompt(input));
    return RecruiterLeadResponseSchema.parse(JSON.parse(extractJsonFromText(raw)));
  }
}
