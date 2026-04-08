/**
 * SerpAPI provider — proxies Google Search results.
 * https://serpapi.com/  (100 free searches/month)
 */

import type { SearchProvider, SearchResponse } from "../base";

export class SerpAPISearchProvider implements SearchProvider {
  readonly providerName = "serpapi";

  private readonly apiKey: string;

  constructor() {
    const key = process.env.SERPAPI_API_KEY;
    if (!key) {
      throw new Error(
        "[SerpAPI] SERPAPI_API_KEY is not set. Get one at https://serpapi.com/"
      );
    }
    this.apiKey = key;
  }

  async search(query: string, maxResults = 10): Promise<SearchResponse> {
    const params = new URLSearchParams({
      api_key: this.apiKey,
      engine: "google",
      q: query,
      num: String(maxResults),
      hl: "en",
      gl: "us",
    });

    const response = await fetch(
      `https://serpapi.com/search.json?${params.toString()}`
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `[SerpAPI] Request failed (${response.status}): ${text}`
      );
    }

    const data = await response.json();

    const organic: Array<{ title?: string; link?: string; snippet?: string }> =
      data.organic_results ?? [];

    const results = organic.map((r) => ({
      title: r.title ?? "",
      url: r.link ?? "",
      snippet: r.snippet ?? "",
    }));

    return { query, results };
  }
}
