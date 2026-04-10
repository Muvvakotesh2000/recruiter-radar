/**
 * OpenAI provider — GPT-4o / GPT-4o-mini.
 */

import type {
  AIProvider,
  RecruiterSearchInput,
  RecruiterLeadResponse,
  SearchQueriesResponse,
} from "@/types/ai";
import type { HunterResult } from "@/lib/services/hunter";
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

export class OpenAIProvider implements AIProvider {
  readonly providerName = "openai";
  readonly modelName: string;

  private readonly apiKey: string;
  private readonly baseUrl = "https://api.openai.com/v1";

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("[OpenAIProvider] OPENAI_API_KEY is not set.");
    }
    this.apiKey = apiKey;
    this.modelName = process.env.OPENAI_MODEL || "gpt-4o";
  }

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
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[OpenAIProvider] API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("[OpenAIProvider] Empty response from API.");
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
    hunterData?: HunterResult | null,
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
