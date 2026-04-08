/**
 * Search provider abstraction.
 * Any search backend (Tavily, SerpAPI, Brave, mock) implements SearchProvider.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Full page content, if the provider fetches it */
  content?: string;
  /** Score or relevance, if provided */
  score?: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

export interface SearchProvider {
  readonly providerName: string;
  search(query: string, maxResults?: number): Promise<SearchResponse>;
}

export type SearchProviderID = "serper";

export const SEARCH_PROVIDER_LABELS: Record<SearchProviderID, string> = {
  serper: "Serper.dev (Google)",
};
