/**
 * Serper.dev provider — Google Search results via a clean REST API.
 *
 * FREE TIER: 2,500 searches on signup, no credit card required.
 * Sign up at: https://serper.dev
 *
 * This gives real Google results including LinkedIn profiles, Apollo,
 * RocketReach, and company pages — ideal for recruiter discovery.
 */

import type { SearchProvider, SearchResponse } from "../base";

export class SerperSearchProvider implements SearchProvider {
  readonly providerName = "serper";

  private readonly apiKey: string;
  private readonly baseUrl = "https://google.serper.dev/search";

  constructor() {
    const key = process.env.SERPER_API_KEY;
    if (!key) {
      throw new Error(
        "[SerperSearch] SERPER_API_KEY is not set.\n" +
          "Get 2,500 free searches (no credit card) at https://serper.dev"
      );
    }
    this.apiKey = key;
  }

  async search(query: string, maxResults = 10): Promise<SearchResponse> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "X-API-KEY": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        num: Math.min(maxResults, 10),
        gl: "us",
        hl: "en",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `[SerperSearch] Request failed (${response.status}): ${text}`
      );
    }

    const data = await response.json();

    // Serper returns organic results + knowledge graph + answer box
    const organic: Array<{
      title?: string;
      link?: string;
      snippet?: string;
      sitelinks?: Array<{ title: string; link: string }>;
    }> = data.organic ?? [];

    const results = organic.map((r) => ({
      title: r.title ?? "",
      url: r.link ?? "",
      snippet: r.snippet ?? "",
    }));

    // Also pull in the "answerBox" if present (often contains direct contact info)
    if (data.answerBox?.snippet) {
      results.unshift({
        title: data.answerBox.title ?? "Answer",
        url: data.answerBox.link ?? "",
        snippet: data.answerBox.snippet,
      });
    }

    return { query, results };
  }
}
