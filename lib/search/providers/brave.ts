/**
 * Brave Search API provider.
 * https://brave.com/search/api/  (2000 free queries/month)
 */

import type { SearchProvider, SearchResponse } from "../base";

export class BraveSearchProvider implements SearchProvider {
  readonly providerName = "brave";

  private readonly apiKey: string;

  constructor() {
    const key = process.env.BRAVE_SEARCH_API_KEY;
    if (!key) {
      throw new Error(
        "[BraveSearch] BRAVE_SEARCH_API_KEY is not set. Get one at https://brave.com/search/api/"
      );
    }
    this.apiKey = key;
  }

  async search(query: string, maxResults = 10): Promise<SearchResponse> {
    const params = new URLSearchParams({
      q: query,
      count: String(maxResults),
      search_lang: "en",
      country: "us",
      safesearch: "off",
    });

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": this.apiKey,
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `[BraveSearch] Request failed (${response.status}): ${text}`
      );
    }

    const data = await response.json();

    const webResults: Array<{
      title?: string;
      url?: string;
      description?: string;
    }> = data?.web?.results ?? [];

    const results = webResults.map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
    }));

    return { query, results };
  }
}
