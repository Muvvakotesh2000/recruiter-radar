/**
 * Job page scraper — fetches the job URL and extracts plain text.
 *
 * Used to find recruiter / hiring-team info directly from the posting
 * (e.g. LinkedIn "Meet the Hiring Team", ATS recruiter fields, job description
 * that names the hiring manager).
 *
 * Fails gracefully: returns null if the page is blocked, requires auth,
 * times out, or returns non-HTML content.
 */

const FETCH_TIMEOUT_MS = 8_000;

/** Focused keywords that suggest recruiter / hiring-team context */
const RECRUITER_KEYWORDS = [
  "hiring team",
  "meet the team",
  "recruiter",
  "talent acquisition",
  "hiring manager",
  "posted by",
  "reach out to",
  "contact us",
  "apply through",
  "questions about",
];

export interface JobPageResult {
  /** Plain-text content extracted from the page (trimmed, max ~5 000 chars) */
  content: string;
  /** Whether we successfully fetched and parsed the page */
  success: boolean;
}

export async function scrapeJobPage(url: string): Promise<JobPageResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      console.log(`[JobScraper] ${url} → HTTP ${res.status} — skipping`);
      return null;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) {
      console.log(`[JobScraper] ${url} — non-HTML content-type, skipping`);
      return null;
    }

    const html = await res.text();

    // Strip <script>, <style>, <svg>, <noscript> blocks entirely
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      // Remove all remaining tags
      .replace(/<[^>]+>/g, " ")
      // Decode common HTML entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim();

    if (stripped.length < 100) {
      // Likely a login wall / redirect page with no real content
      console.log(`[JobScraper] ${url} — page too short after stripping, likely a wall`);
      return null;
    }

    // Try to extract a focused window around recruiter-related keywords
    // so we don't waste tokens on irrelevant boilerplate
    const lower = stripped.toLowerCase();
    let focusedContent = "";

    for (const kw of RECRUITER_KEYWORDS) {
      const idx = lower.indexOf(kw);
      if (idx !== -1) {
        // Grab 800 chars of context around the keyword
        const start = Math.max(0, idx - 200);
        const end = Math.min(stripped.length, idx + 600);
        focusedContent += stripped.slice(start, end) + "\n---\n";
        if (focusedContent.length > 3_000) break;
      }
    }

    // Fall back to the first 4 000 chars if no keywords matched
    const content = focusedContent.length > 50
      ? focusedContent.slice(0, 5_000)
      : stripped.slice(0, 4_000);

    console.log(
      `[JobScraper] ${url} — extracted ${content.length} chars` +
      (focusedContent.length > 50 ? " (keyword-focused)" : " (first-N fallback)")
    );

    return { content, success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // AbortError = timeout, TypeError = network error — both are expected
    if (!msg.includes("abort") && !msg.includes("fetch")) {
      console.warn(`[JobScraper] Unexpected error for ${url}: ${msg}`);
    } else {
      console.log(`[JobScraper] ${url} — fetch failed (${msg.split(":")[0]}), skipping`);
    }
    return null;
  }
}
