import { NextRequest, NextResponse } from "next/server";

export interface ParsedJobData {
  company_name: string | null;
  job_title: string | null;
  location: string | null;
  is_remote: boolean;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  try {
    new URL(url); // validate
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    const result = await parseJobUrl(url);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to parse job URL";
    return NextResponse.json({ success: false, error: msg }, { status: 200 });
  }
}

async function parseJobUrl(url: string): Promise<ParsedJobData> {
  // ── 1. Try to extract from URL patterns before fetching ──────────────────────
  const fromUrl = extractFromUrlPattern(url);

  // ── 2. Fetch the page ────────────────────────────────────────────────────────
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(8000),
    // @ts-ignore — Next.js fetch extension to disable caching
    cache: "no-store",
  });

  if (!res.ok) {
    // Still return URL-derived data if available
    if (fromUrl.company_name || fromUrl.job_title) return fromUrl;
    throw new Error(`HTTP ${res.status}`);
  }

  const html = await res.text();

  // ── 3. JSON-LD JobPosting (most reliable — Greenhouse, Lever, Indeed, etc.) ──
  const jsonLd = extractJsonLd(html);
  if (jsonLd) {
    return mergeWithUrlData(jsonLd, fromUrl);
  }

  // ── 4. OG / meta tags fallback ───────────────────────────────────────────────
  const ogData = extractOgMeta(html, url);
  return mergeWithUrlData(ogData, fromUrl);
}

// ── JSON-LD extraction ─────────────────────────────────────────────────────────

function extractJsonLd(html: string): ParsedJobData | null {
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;

  while ((m = scriptRe.exec(html)) !== null) {
    try {
      const json = JSON.parse(m[1]);
      const items: any[] = Array.isArray(json)
        ? json
        : json["@graph"]
        ? json["@graph"]
        : [json];

      for (const item of items) {
        if (item["@type"] !== "JobPosting") continue;

        const title = item.title?.trim() ?? item.name?.trim() ?? null;
        const company =
          item.hiringOrganization?.name?.trim() ??
          item.hiringOrganization?.["@name"]?.trim() ??
          null;

        const isRemote =
          item.jobLocationType === "TELECOMMUTE" ||
          item.workplaceType === "remote" ||
          /remote/i.test(item.jobLocationType ?? "");

        let location: string | null = null;
        if (!isRemote) {
          const locs: any[] = Array.isArray(item.jobLocation)
            ? item.jobLocation
            : item.jobLocation
            ? [item.jobLocation]
            : [];

          if (locs.length > 0) {
            const addr = locs[0]?.address;
            if (addr) {
              const parts = [addr.addressLocality, addr.addressRegion]
                .filter(Boolean)
                .map((s: string) => s.trim());
              location = parts.length > 0 ? parts.join(", ") : (addr.addressCountry ?? null);
            }
          }
        }

        if (title || company) {
          return {
            company_name: company,
            job_title: title,
            location: isRemote ? "Remote" : location,
            is_remote: isRemote,
          };
        }
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return null;
}

// ── OG / meta extraction ───────────────────────────────────────────────────────

function extractOgMeta(html: string, url: string): ParsedJobData {
  const getMeta = (prop: string): string | null => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );
    const m = re.exec(html) ??
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i").exec(html);
    return m ? decodeHtmlEntities(m[1].trim()) : null;
  };

  const ogTitle = getMeta("og:title");
  const twitterTitle = getMeta("twitter:title");
  const pageTitle = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const rawTitle = ogTitle ?? twitterTitle ?? pageTitle ?? null;

  const ogSiteName = getMeta("og:site_name");
  const ogDesc = getMeta("og:description") ?? getMeta("description") ?? "";

  // Common pattern: "Job Title at Company" or "Job Title | Company"
  let jobTitle: string | null = null;
  let companyName: string | null = ogSiteName ?? null;

  if (rawTitle) {
    // "Job Title at Company Name - Job Board"
    const atMatch = /^(.+?)\s+at\s+([^|\-–]+)/i.exec(rawTitle);
    if (atMatch) {
      jobTitle = atMatch[1].trim();
      companyName = companyName ?? atMatch[2].trim();
    } else {
      // "Job Title | Company | ..."
      const pipeMatch = /^([^|]+)\s*\|\s*([^|]+)/.exec(rawTitle);
      if (pipeMatch) {
        jobTitle = pipeMatch[1].trim();
        companyName = companyName ?? pipeMatch[2].trim();
      } else {
        jobTitle = rawTitle.split(/[|\-–]/)[0].trim();
      }
    }
  }

  // Detect remote from description
  const isRemote = /\bremote\b/i.test(ogDesc) || /\bremote\b/i.test(rawTitle ?? "");

  // Try to find location in description (e.g. "New York, NY · Full-time")
  let location: string | null = null;
  if (!isRemote) {
    const locMatch = ogDesc.match(
      /\b([A-Z][a-zA-Z\s]+,\s*(?:[A-Z]{2}|[A-Za-z]+))\b/
    );
    location = locMatch?.[1] ?? null;
  }

  return {
    company_name: companyName,
    job_title: jobTitle,
    location: isRemote ? "Remote" : location,
    is_remote: isRemote,
  };
}

// ── URL pattern extraction ─────────────────────────────────────────────────────

function extractFromUrlPattern(url: string): ParsedJobData {
  const empty: ParsedJobData = { company_name: null, job_title: null, location: null, is_remote: false };

  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname;

    // Greenhouse: boards.greenhouse.io/{company}/jobs/{id}
    if (host.includes("greenhouse.io")) {
      const m = path.match(/^\/([^/]+)\/jobs\//);
      if (m) return { ...empty, company_name: humanize(m[1]) };
    }

    // Lever: jobs.lever.co/{company}/{uuid}
    if (host.includes("lever.co")) {
      const m = path.match(/^\/([^/]+)\//);
      if (m) return { ...empty, company_name: humanize(m[1]) };
    }

    // Ashby: jobs.ashbyhq.com/{company}/{uuid}
    if (host.includes("ashbyhq.com")) {
      const m = path.match(/^\/([^/]+)\//);
      if (m) return { ...empty, company_name: humanize(m[1]) };
    }

    // LinkedIn: linkedin.com/jobs/view/{title}-at-{company}-{id}
    if (host.includes("linkedin.com")) {
      const m = path.match(/\/jobs\/view\/(.+?)-(\d+)\/?$/);
      if (m) {
        const slug = m[1];
        // Slug: "senior-software-engineer-at-stripe" or just "senior-software-engineer-123"
        const atIdx = slug.lastIndexOf("-at-");
        if (atIdx !== -1) {
          return {
            ...empty,
            job_title: humanize(slug.slice(0, atIdx)),
            company_name: humanize(slug.slice(atIdx + 4)),
          };
        }
        return { ...empty, job_title: humanize(slug) };
      }
    }

    // Workday: {company}.wd{n}.myworkdayjobs.com/...
    const workdayMatch = host.match(/^([\w-]+)\.wd\d+\.myworkdayjobs\.com$/);
    if (workdayMatch) {
      return { ...empty, company_name: humanize(workdayMatch[1]) };
    }

    // Company-hosted Lever/Greenhouse subdomains: jobs.{company}.com
    const subdomainMatch = host.match(/^jobs\.([\w-]+)\.(com|io|co|ai|app)$/);
    if (subdomainMatch) {
      return { ...empty, company_name: humanize(subdomainMatch[1]) };
    }
  } catch {
    // ignore
  }

  return empty;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function humanize(slug: string): string {
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function mergeWithUrlData(parsed: ParsedJobData, fromUrl: ParsedJobData): ParsedJobData {
  return {
    company_name: parsed.company_name ?? fromUrl.company_name,
    job_title: parsed.job_title ?? fromUrl.job_title,
    location: parsed.location ?? fromUrl.location,
    is_remote: parsed.is_remote || fromUrl.is_remote,
  };
}
