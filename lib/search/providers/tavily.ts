/**
 * Tavily AI Search provider.
 * Tavily is purpose-built for AI agent workflows — it returns clean snippets
 * and optionally full page content without needing a headless browser.
 * https://app.tavily.com/  (free tier: 1000 searches/month)
 */

import type { SearchProvider, SearchResponse } from "../base";

export class TavilySearchProvider implements SearchProvider {
  readonly providerName = "tavily";

  private readonly apiKey: string;

  constructor() {
    const key = process.env.TAVILY_API_KEY;
    if (!key) {
      throw new Error(
        "[TavilySearch] TAVILY_API_KEY is not set. Get one at https://app.tavily.com/"
      );
    }
    this.apiKey = key;
  }

  async search(query: string, maxResults = 7): Promise<SearchResponse> {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        search_depth: "advanced",
        include_answer: false,
        include_raw_content: false,
        max_results: maxResults,
        // Prioritise recruiter-rich domains
        include_domains: [
          "linkedin.com",
          "apollo.io",
          "rocketreach.co",
          "hunter.io",
          "contactout.com",
          "github.com",
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `[TavilySearch] Request failed (${response.status}): ${text}`
      );
    }

    const data = await response.json();

    const results = (data.results ?? []).map(
      (r: { title?: string; url?: string; content?: string; score?: number }) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
        score: r.score,
      })
    );

    return { query, results };
  }
}
