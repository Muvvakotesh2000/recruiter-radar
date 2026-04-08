import type { SearchProvider } from "./base";
import { SerperSearchProvider } from "./providers/serper";

/**
 * Returns the Serper search provider. Only Serper is supported.
 */
export async function getSearchProvider(_override?: string): Promise<SearchProvider> {
  return new SerperSearchProvider();
}
