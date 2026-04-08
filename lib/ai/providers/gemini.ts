/**
 * Google Gemini provider.
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

export class GeminiProvider implements AIProvider {
  readonly providerName = "gemini";
  readonly modelName: string;

  private readonly apiKey: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("[GeminiProvider] GEMINI_API_KEY is not set.");
    }
    this.apiKey = apiKey;
    this.modelName = process.env.GEMINI_MODEL || "gemini-1.5-pro";
  }

  private async call(system: string, user: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[GeminiProvider] API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error("[GeminiProvider] Empty response from API.");
    return content;
  }

  async generateQueries(
    input: RecruiterSearchInput
  ): Promise<SearchQueriesResponse> {
    return generateSearchQueries(input, (sys, usr) => this.call(sys, usr));
  }

  async extractContacts(
    input: RecruiterSearchInput,
    searchResults: SearchResult[]
  ): Promise<RecruiterLeadResponse> {
    const raw = await this.call(
      buildExtractionSystemPrompt(),
      buildExtractionPrompt(input, searchResults)
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
