export interface ParsedJobData {
  company_name: string | null;
  job_title: string | null;
  location: string | null;
  is_remote: boolean;
  source: "json-ld" | "embedded-json" | "meta" | "url" | "combined";
  confidence: "high" | "medium" | "low";
}

type UnknownRecord = Record<string, unknown>;

const EMPTY_JOB: ParsedJobData = {
  company_name: null,
  job_title: null,
  location: null,
  is_remote: false,
  source: "url",
  confidence: "low",
};

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_CHARS = 1_500_000;

const KNOWN_BOARD_SUFFIXES = [
  "greenhouse",
  "lever",
  "workday",
  "ashby",
  "jobvite",
  "smartrecruiters",
  "recruitee",
  "bamboohr",
  "icims",
  "linkedin",
  "indeed",
  "careers",
  "jobs",
];

export async function parseJobUrl(url: string): Promise<ParsedJobData> {
  const fromUrl = extractFromUrlPattern(url);
  const fetched = await fetchJobHtml(url);

  if (!fetched) {
    if (hasUsefulData(fromUrl)) return fromUrl;
    throw new Error("Unable to read job page");
  }

  const { html, finalUrl } = fetched;
  const candidates = [
    ...extractJsonLdCandidates(html),
    ...extractEmbeddedJsonCandidates(html),
    extractMetaCandidate(html),
  ].filter(hasUsefulData);

  const bestCandidate = rankCandidates(candidates)[0] ?? EMPTY_JOB;
  const merged = mergeWithUrlData(bestCandidate, extractFromUrlPattern(finalUrl), fromUrl);

  if (!hasUsefulData(merged)) {
    throw new Error("No job details found on the page");
  }

  return normalizeParsedJob(merged);
}

async function fetchJobHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().includes("html")) return null;

    const html = (await response.text()).slice(0, MAX_HTML_CHARS);
    return { html, finalUrl: response.url || url };
  } catch {
    return null;
  }
}

function extractJsonLdCandidates(html: string): ParsedJobData[] {
  const candidates: ParsedJobData[] = [];
  const scriptRe = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRe.exec(html)) !== null) {
    const parsed = parseJsonLoose(match[1]);
    if (parsed === null) continue;

    for (const item of flattenJson(parsed)) {
      if (!isJobPosting(item)) continue;
      const job = extractFromJobPosting(item, "json-ld");
      if (hasUsefulData(job)) candidates.push(job);
    }
  }

  return candidates;
}

function extractEmbeddedJsonCandidates(html: string): ParsedJobData[] {
  const candidates: ParsedJobData[] = [];
  const scriptRe = /<script\b(?![^>]*type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRe.exec(html)) !== null) {
    const script = match[1].trim();
    if (!script || !looksLikeJobJson(script)) continue;

    const greenhouseRemixJob = extractGreenhouseRemixJob(script);
    if (greenhouseRemixJob) candidates.push(greenhouseRemixJob);

    for (const jsonText of extractJsonBlobs(script)) {
      const parsed = parseJsonLoose(jsonText);
      if (parsed === null) continue;

      const jobLike = findJobLikeRecords(parsed);
      for (const item of jobLike) {
        const job = extractFromGenericJobRecord(item);
        if (hasUsefulData(job)) candidates.push(job);
      }
    }
  }

  return candidates;
}

function extractGreenhouseRemixJob(script: string): ParsedJobData | null {
  if (!script.includes("window.__remixContext") || !script.includes('"jobPost"')) {
    return null;
  }

  const jobPostStart = script.indexOf('"jobPost"');
  const jobPostSlice = script.slice(jobPostStart, jobPostStart + 80_000);
  const title = readJsonStringField(jobPostSlice, "title");
  const company = readJsonStringField(jobPostSlice, "company_name");
  const location = readJsonStringField(jobPostSlice, "job_post_location");
  const remote = isRemoteText(location ?? "");

  if (!title && !company && !location) return null;

  return normalizeParsedJob({
    company_name: cleanCompanyName(company),
    job_title: cleanJobTitle(title),
    location: remote ? "Remote" : cleanLocation(location),
    is_remote: remote,
    source: "embedded-json",
    confidence: company && title && (location || remote) ? "high" : "medium",
  });
}

function readJsonStringField(text: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`"${escapedKey}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(text);
  if (!match) return null;

  try {
    return normalizeText(JSON.parse(`"${match[1]}"`));
  } catch {
    return normalizeText(unescapeJsString(match[1]));
  }
}

function extractMetaCandidate(html: string): ParsedJobData {
  const meta = getMetaMap(html);
  const title =
    meta.get("og:title") ??
    meta.get("twitter:title") ??
    extractTitleTag(html);
  const description =
    meta.get("og:description") ??
    meta.get("twitter:description") ??
    meta.get("description") ??
    "";
  const siteName = cleanCompanyName(meta.get("og:site_name") ?? meta.get("application-name") ?? null);

  const linkedInTitle = parseLinkedInTitle(title);
  const parsedTitle = linkedInTitle ?? parseTitleAndCompany(title, siteName);
  const location =
    extractLocationFromText(description) ??
    linkedInTitle?.location ??
    extractLocationFromText(title ?? "");
  const isRemote = isRemoteText(`${title ?? ""} ${description} ${location ?? ""}`);

  return normalizeParsedJob({
    company_name: parsedTitle.company,
    job_title: parsedTitle.title,
    location: isRemote ? "Remote" : location,
    is_remote: isRemote,
    source: "meta",
    confidence: parsedTitle.company && parsedTitle.title ? "medium" : "low",
  });
}

function extractFromJobPosting(item: UnknownRecord, source: ParsedJobData["source"]): ParsedJobData {
  const title = firstText(item.title, item.name);
  const company = extractOrganizationName(item.hiringOrganization);
  const remote = isRemoteJobPosting(item);
  const location = remote ? "Remote" : extractJobLocation(item.jobLocation);

  return normalizeParsedJob({
    company_name: company,
    job_title: title,
    location,
    is_remote: remote,
    source,
    confidence: company && title && (location || remote) ? "high" : "medium",
  });
}

function extractFromGenericJobRecord(item: UnknownRecord): ParsedJobData {
  const title = firstText(
    item.title,
    item.jobTitle,
    item.job_title,
    item.name,
    item.position,
    item.positionTitle,
  );
  const company = cleanCompanyName(firstText(
    item.company,
    item.companyName,
    item.company_name,
    item.organization,
    item.departmentName,
  ));
  const location = firstText(
    item.location,
    item.locationName,
    item.jobLocation,
    item.job_post_location,
    item.jobPostLocation,
    item.primaryLocation,
    item.office,
  );
  const remote = isRemoteText(`${firstText(item.workplaceType, item.remote, item.locationType) ?? ""} ${location ?? ""}`);

  return normalizeParsedJob({
    company_name: company,
    job_title: title,
    location: remote ? "Remote" : cleanLocation(location),
    is_remote: remote,
    source: "embedded-json",
    confidence: company && title ? "medium" : "low",
  });
}

function extractFromUrlPattern(url: string): ParsedJobData {
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
    const path = decodeURIComponent(parsedUrl.pathname);
    const params = parsedUrl.searchParams;

    if (host.includes("greenhouse.io")) {
      const company = path.match(/^\/([^/]+)\/jobs\//)?.[1] ?? host.match(/^([^./]+)\.greenhouse\.io$/)?.[1];
      return withUrlData(company, null);
    }

    if (host.includes("lever.co")) {
      return withUrlData(path.match(/^\/([^/]+)\//)?.[1] ?? null, null);
    }

    if (host.includes("ashbyhq.com")) {
      return withUrlData(path.match(/^\/([^/]+)\//)?.[1] ?? null, null);
    }

    if (host.includes("smartrecruiters.com")) {
      const match = path.match(/^\/([^/]+)\/([^/]+)/);
      return withUrlData(match?.[1] ?? null, match?.[2] ?? null);
    }

    if (host.includes("myworkdayjobs.com")) {
      const company = host.match(/^([\w-]+)\.wd\d+\.myworkdayjobs\.com$/)?.[1] ??
        path.match(/^\/([^/]+)\//)?.[1] ??
        null;
      return withUrlData(company, null);
    }

    if (host.includes("linkedin.com")) {
      const slug = path.match(/\/jobs\/view\/(.+?)(?:-\d+)?\/?$/)?.[1];
      if (slug) {
        const atIdx = slug.lastIndexOf("-at-");
        if (atIdx !== -1) {
          return withUrlData(slug.slice(atIdx + 4), slug.slice(0, atIdx));
        }
        return withUrlData(null, slug);
      }
    }

    const queryTitle = firstText(params.get("jobTitle"), params.get("title"), params.get("gh_jid"));
    const companyFromSubdomain = extractCompanyFromHost(host);
    const slugTitle = extractLikelyTitleFromPath(path);

    return withUrlData(companyFromSubdomain, queryTitle && !/^\d+$/.test(queryTitle) ? queryTitle : slugTitle);
  } catch {
    return EMPTY_JOB;
  }
}

function withUrlData(company: string | null | undefined, title: string | null | undefined): ParsedJobData {
  return normalizeParsedJob({
    ...EMPTY_JOB,
    company_name: cleanCompanyName(humanizeSlug(company)),
    job_title: cleanJobTitle(humanizeSlug(title)),
  });
}

function mergeWithUrlData(...items: ParsedJobData[]): ParsedJobData {
  const primary = items.find((item) => item.source !== "url" && hasUsefulData(item)) ?? EMPTY_JOB;
  const merged = items.reduce<ParsedJobData>(
    (acc, item) => ({
      company_name: acc.company_name ?? item.company_name,
      job_title: acc.job_title ?? item.job_title,
      location: acc.location ?? item.location,
      is_remote: acc.is_remote || item.is_remote,
      source: acc.source === "url" && item.source !== "url" ? "combined" : acc.source,
      confidence: bestConfidence(acc.confidence, item.confidence),
    }),
    { ...primary },
  );

  return normalizeParsedJob(merged);
}

function rankCandidates(candidates: ParsedJobData[]): ParsedJobData[] {
  const sourceScore = { "json-ld": 4, "embedded-json": 3, meta: 2, combined: 2, url: 1 };
  const confidenceScore = { high: 3, medium: 2, low: 1 };

  return [...candidates].sort((a, b) => {
    const aRequired = Number(Boolean(a.company_name)) + Number(Boolean(a.job_title)) + Number(Boolean(a.location));
    const bRequired = Number(Boolean(b.company_name)) + Number(Boolean(b.job_title)) + Number(Boolean(b.location));
    return (
      bRequired - aRequired ||
      confidenceScore[b.confidence] - confidenceScore[a.confidence] ||
      sourceScore[b.source] - sourceScore[a.source]
    );
  });
}

function parseJsonLoose(text: string): unknown | null {
  const cleaned = decodeHtmlEntities(text)
    .replace(/^\s*<!--/, "")
    .replace(/-->\s*$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function flattenJson(value: unknown): UnknownRecord[] {
  const records: UnknownRecord[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (!isRecord(node)) return;
    records.push(node);

    for (const key of ["@graph", "graph", "itemListElement", "mainEntity", "about"]) {
      if (key in node) visit(node[key]);
    }
  };

  visit(value);
  return records;
}

function isJobPosting(item: UnknownRecord): boolean {
  const type = item["@type"] ?? item.type;
  if (Array.isArray(type)) return type.some((entry) => normalizeText(String(entry)).toLowerCase() === "jobposting");
  return normalizeText(String(type ?? "")).toLowerCase() === "jobposting";
}

function findJobLikeRecords(value: unknown): UnknownRecord[] {
  const found: UnknownRecord[] = [];
  const seen = new Set<unknown>();

  const visit = (node: unknown, depth: number) => {
    if (depth > 8 || node === null || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }

    if (!isRecord(node)) return;

    const keys = Object.keys(node).map((key) => key.toLowerCase());
    const looksLikeJob =
      keys.some((key) => ["jobtitle", "job_title", "title", "positiontitle"].includes(key)) &&
      keys.some((key) => ["company", "companyname", "company_name", "hiringorganization", "location", "joblocation"].includes(key));

    if (looksLikeJob || isJobPosting(node)) found.push(node);

    for (const value of Object.values(node)) visit(value, depth + 1);
  };

  visit(value, 0);
  return found;
}

function looksLikeJobJson(script: string): boolean {
  return /jobposting|jobPost|jobTitle|job_title|job_post_location|hiringOrganization|jobLocation|positionTitle|companyName|company_name/i.test(script);
}

function extractJsonBlobs(script: string): string[] {
  const blobs: string[] = [];
  const nextData = script.match(/self\.__next_f\.push\(\[(?:\d+),\s*"([\s\S]*)"\]\)/)?.[1];
  if (nextData) blobs.push(unescapeJsString(nextData));

  const assignmentRe = /(?:window\.__INITIAL_STATE__|window\.__APOLLO_STATE__|window\.__remixContext|__NEXT_DATA__|window\.initialState)\s*=\s*({[\s\S]*?});/gi;
  let match: RegExpExecArray | null;
  while ((match = assignmentRe.exec(script)) !== null) {
    blobs.push(match[1]);
  }

  if (script.startsWith("{") || script.startsWith("[")) blobs.push(script);
  return blobs;
}

function getMetaMap(html: string): Map<string, string> {
  const meta = new Map<string, string>();
  const metaRe = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaRe.exec(html)) !== null) {
    const attrs = parseAttributes(match[0]);
    const key = normalizeText(attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase();
    const content = attrs.content;
    if (key && content && !meta.has(key)) meta.set(key, decodeHtmlEntities(content));
  }

  return meta;
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;

  while ((match = attrRe.exec(tag)) !== null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }

  return attrs;
}

function extractTitleTag(html: string): string | null {
  return decodeHtmlEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim() || null;
}

function parseLinkedInTitle(rawTitle: string | null): { title: string | null; company: string | null; location: string | null } | null {
  if (!rawTitle || !/\blinkedin\b/i.test(rawTitle)) return null;

  const cleaned = normalizeText(rawTitle)
    .replace(/\s+\|\s*LinkedIn\s*$/i, "")
    .trim();
  const match = /^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+(.+))?$/i.exec(cleaned);

  if (!match) return null;

  return {
    company: cleanCompanyName(match[1]),
    title: cleanJobTitle(match[2]),
    location: cleanLocation(match[3] ?? null),
  };
}

function parseTitleAndCompany(rawTitle: string | null, fallbackCompany: string | null): { title: string | null; company: string | null } {
  if (!rawTitle) return { title: null, company: fallbackCompany };

  const cleaned = normalizeText(rawTitle)
    .replace(/\b(apply now|careers|jobs|job details|job openings)\b/gi, "")
    .trim();

  const separators = [
    /\s+at\s+/i,
    /\s+\|\s+/,
    /\s+-\s+/,
    /\s+[\u2013\u2014]\s+/,
    /\s+::\s+/,
  ];

  for (const separator of separators) {
    const parts = cleaned.split(separator).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const title = cleanJobTitle(parts[0]);
      const company = cleanCompanyName(fallbackCompany ?? parts[1]);
      return { title, company };
    }
  }

  return { title: cleanJobTitle(cleaned), company: fallbackCompany };
}

function extractOrganizationName(value: unknown): string | null {
  if (typeof value === "string") return cleanCompanyName(value);
  if (Array.isArray(value)) return extractOrganizationName(value[0]);
  if (!isRecord(value)) return null;

  return cleanCompanyName(firstText(value.name, value.legalName, value["@name"], value.alternateName));
}

function extractJobLocation(value: unknown): string | null {
  if (typeof value === "string") return cleanLocation(value);
  if (Array.isArray(value)) {
    const locations = value.map(extractJobLocation).filter(Boolean) as string[];
    return locations.length > 0 ? unique(locations).slice(0, 3).join(" / ") : null;
  }
  if (!isRecord(value)) return null;

  const address = value.address;
  if (typeof address === "string") return cleanLocation(address);
  if (isRecord(address)) {
    const locality = firstText(address.addressLocality, address.locality);
    const region = firstText(address.addressRegion, address.region);
    const country = firstText(address.addressCountry, address.country);
    return cleanLocation([locality, region, country].filter(Boolean).join(", "));
  }

  return cleanLocation(firstText(value.name, value.location, value.city));
}

function extractLocationFromText(text: string): string | null {
  const cleaned = normalizeText(text);
  const patterns = [
    /\b(?:location|office|based in)\s*[:\-]\s*([A-Z][A-Za-z .'-]+,\s*(?:[A-Z]{2}|[A-Za-z .'-]+))(?:\b|[|.;])/i,
    /\b([A-Z][A-Za-z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY))\b/,
    /\b([A-Z][A-Za-z .'-]+,\s*(?:United States|USA|Canada|India|United Kingdom|UK|Germany|France|Ireland|Australia))\b/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const location = cleanLocation(match?.[1] ?? null);
    if (location) return location;
  }

  return null;
}

function isRemoteJobPosting(item: UnknownRecord): boolean {
  const remoteSignals = [
    item.jobLocationType,
    item.workplaceType,
    item.employmentType,
    item.description,
    item.applicantLocationRequirements,
  ];

  return remoteSignals.some((signal) => isRemoteText(JSON.stringify(signal ?? "")));
}

function isRemoteText(text: string): boolean {
  return /\b(remote|telecommute|work from home|work-from-home|anywhere)\b/i.test(text);
}

function extractCompanyFromHost(host: string): string | null {
  const parts = host.split(".");
  if (parts.length < 2) return null;

  const first = parts[0];
  const second = parts[1];
  if (["jobs", "careers", "boards", "apply", "recruiting"].includes(first)) return second;
  if (KNOWN_BOARD_SUFFIXES.some((suffix) => host.includes(suffix))) return null;
  return first;
}

function extractLikelyTitleFromPath(path: string): string | null {
  const segments = path.split("/").filter(Boolean).reverse();
  const segment = segments.find((part) =>
    /[a-z]/i.test(part) &&
    part.includes("-") &&
    !/^\d+$/.test(part) &&
    !/^(job|jobs|careers|apply|opening|requisition)$/i.test(part),
  );
  if (!segment) return null;

  return segment
    .replace(/-\d+$/g, "")
    .replace(/(?:req|job|jr)-?\d+/gi, "");
}

function normalizeParsedJob(job: ParsedJobData): ParsedJobData {
  const isRemote = job.is_remote || isRemoteText(job.location ?? "");

  return {
    company_name: cleanCompanyName(job.company_name),
    job_title: cleanJobTitle(job.job_title),
    location: isRemote ? "Remote" : cleanLocation(job.location),
    is_remote: isRemote,
    source: job.source,
    confidence: job.confidence,
  };
}

function cleanCompanyName(value: string | null | undefined): string | null {
  const cleaned = normalizeText(value ?? "")
    .replace(/\b(careers|jobs|job board|greenhouse|lever|workday|ashby)\b/gi, "")
    .replace(/\s+[-|]\s+.*$/g, "")
    .trim();

  return cleaned || null;
}

function cleanJobTitle(value: string | null | undefined): string | null {
  const cleaned = normalizeText(value ?? "")
    .replace(/\b(apply now|job details|careers|jobs)\b/gi, "")
    .replace(/\s*\([^)]*remote[^)]*\)\s*/gi, " ")
    .trim();

  return cleaned || null;
}

function cleanLocation(value: string | null | undefined): string | null {
  const cleaned = normalizeText(value ?? "")
    .replace(/\b(full[- ]time|part[- ]time|contract|internship|apply now)\b/gi, "")
    .replace(/^[,|.\-\s]+|[,|.\-\s]+$/g, "")
    .trim();

  return cleaned || null;
}

function humanizeSlug(value: string | null | undefined): string | null {
  if (!value) return null;
  return decodeURIComponent(value)
    .replace(/\?.*$/g, "")
    .replace(/[_+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([a-f0-9]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

function unescapeJsString(value: string): string {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&");
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return normalizeText(value);
    if (typeof value === "number") return String(value);
    if (isRecord(value)) {
      const nested = firstText(value.name, value.title, value.label, value.value);
      if (nested) return nested;
    }
  }

  return null;
}

function hasUsefulData(job: ParsedJobData): boolean {
  return Boolean(job.company_name || job.job_title || job.location || job.is_remote);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function bestConfidence(a: ParsedJobData["confidence"], b: ParsedJobData["confidence"]): ParsedJobData["confidence"] {
  const score = { high: 3, medium: 2, low: 1 };
  return score[b] > score[a] ? b : a;
}
