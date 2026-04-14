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

const FETCH_TIMEOUT_MS = 20_000;
const MAX_HTML_CHARS = 1_500_000;

const KNOWN_BOARD_SUFFIXES = [
  "ats",
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
  "governmentjobs",
  "schooljobs",
  "neogov",
  "careers",
  "jobs",
];

const US_STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

export async function parseJobUrl(url: string): Promise<ParsedJobData> {
  const fromUrl = extractFromUrlPattern(url);
  const fetched = await fetchJobHtml(url);

  if (!fetched) {
    if (hasUsefulData(fromUrl)) return fromUrl;
    throw new Error("Unable to read job page");
  }

  const { html, finalUrl } = fetched;
  const boardApiCandidate = await extractBoardApiCandidate(finalUrl);
  const candidates = [
    boardApiCandidate,
    ...extractJsonLdCandidates(html),
    ...extractEmbeddedJsonCandidates(html),
    extractPlainTextCandidate(html, finalUrl),
    extractMetaCandidate(html),
  ].filter((candidate): candidate is ParsedJobData => candidate !== null && hasUsefulData(candidate));

  const bestCandidate = rankCandidates(candidates)[0] ?? EMPTY_JOB;
  const merged = finaliseParsedJob(
    applyBoardSpecificCorrections(
      mergeWithUrlData(bestCandidate, extractFromUrlPattern(finalUrl), fromUrl),
      html,
      finalUrl,
    ),
    candidates,
    html,
    finalUrl,
  );

  if (!hasUsefulData(merged)) {
    throw new Error("No job details found on the page");
  }

  return normalizeParsedJob(merged);
}

async function fetchJobHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const readableUrl = getReadableJobPageUrl(url);

  try {
    const response = await fetch(readableUrl, {
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

    if (!response.ok) return fetchReaderJobPage(readableUrl);

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().includes("html")) return fetchReaderJobPage(readableUrl);

    const html = (await response.text()).slice(0, MAX_HTML_CHARS);
    if (isBotChallengePage(html)) return fetchReaderJobPage(readableUrl);
    return { html, finalUrl: response.url || readableUrl };
  } catch {
    return fetchReaderJobPage(readableUrl);
  }
}

function getReadableJobPageUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname.toLowerCase().includes("lever.co")) {
      parsedUrl.pathname = parsedUrl.pathname.replace(/\/apply\/?$/i, "");
      parsedUrl.search = "";
      parsedUrl.hash = "";
      return parsedUrl.toString();
    }
  } catch {
    return url;
  }

  return url;
}

async function fetchReaderJobPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const readerUrl = `https://r.jina.ai/http://r.jina.ai/http://${url}`;
    const response = await fetch(readerUrl, {
      headers: {
        Accept: "text/plain, text/markdown, */*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) return null;

    const html = (await response.text()).slice(0, MAX_HTML_CHARS);
    if (!html || isBotChallengePage(html)) return null;
    return { html, finalUrl: url };
  } catch {
    return null;
  }
}

function isBotChallengePage(html: string): boolean {
  return /\b(Just a moment|Enable JavaScript and cookies|cf_chl_|challenge-platform|checking your browser)\b/i.test(html);
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

function extractPlainTextCandidate(text: string, finalUrl: string): ParsedJobData | null {
  const titleLine = text.match(/^Title:\s*(.+)$/im)?.[1]?.replace(/\s+in\s*$/i, "") ?? null;
  const locationLine =
    text.match(/^Location:\s*(.+)$/im)?.[1] ??
    text.match(/^\s*([A-Z][A-Za-z .'-]+(?:,\s*[A-Z]{2})?(?:,\s*[A-Za-z .'-]+)?\s*\(Remote\)|Remote)\s*$/im)?.[1] ??
    null;
  const remote = isRemoteText(locationLine ?? "");
  const location = remote ? "Remote" : cleanLocation(locationLine) ?? extractLocationFromText(text);
  const fromUrl = extractFromUrlPattern(finalUrl);
  const titleMeta = new Map<string, string>([["og:url", finalUrl]]);
  if (locationLine) {
    titleMeta.set("twitter:label1", "Location");
    titleMeta.set("twitter:data1", locationLine);
  }
  const parsedTitle = parseTitleAndCompany(titleLine, fromUrl.company_name, titleMeta);
  const title = stripLocationFromTitle(
    parsedTitle.title ?? fromUrl.job_title,
    location,
  );
  const company =
    fromUrl.company_name ??
    parsedTitle.company ??
    extractCompanyFromOwnedJobHost(finalUrl) ??
    extractEmployerFromDescription(text);

  if (!title && !company && !location && !remote) return null;

  return normalizeParsedJob({
    company_name: company,
    job_title: title,
    location,
    is_remote: remote,
    source: "embedded-json",
    confidence: title && (location || remote) ? "high" : "medium",
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
  const parsedTitle = linkedInTitle ?? parseTitleAndCompany(title, siteName, meta);
  const location =
    extractMetaLabelValue(meta, "location") ??
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
  const physicalLocation = extractJobLocation(item.jobLocation);
  const description = firstText(item.description);
  const remote = isRemoteJobPosting(item) && !(physicalLocation && isHybridOrOfficeText(description ?? ""));
  const location = remote && !physicalLocation ? "Remote" : physicalLocation;

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
    item.Title,
    item.title,
    item.jobTitle,
    item.job_title,
    item.JobTitle,
    item.name,
    item.position,
    item.positionTitle,
  );
  const company = cleanCompanyName(firstText(
    item.company,
    item.companyName,
    item.company_name,
    item.organization,
    item.Organization,
    item.BusinessUnit,
    item.LegalEmployer,
    item.departmentName,
  ));
  const location = firstText(
    item.PrimaryLocation,
    item.location,
    item.locationName,
    item.jobLocation,
    item.job_post_location,
    item.jobPostLocation,
    item.primaryLocation,
    item.office,
  );
  const remote = isRemoteText(`${firstText(item.WorkplaceType, item.WorkplaceTypeCode, item.workplaceType, item.remote, item.locationType) ?? ""} ${location ?? ""}`);

  return normalizeParsedJob({
    company_name: company,
    job_title: title,
    location: remote ? "Remote" : cleanLocation(location),
    is_remote: remote,
    source: "embedded-json",
    confidence: company && title ? "medium" : "low",
  });
}

async function extractBoardApiCandidate(url: string): Promise<ParsedJobData | null> {
  return extractOracleHcmCandidate(url);
}

async function extractOracleHcmCandidate(url: string): Promise<ParsedJobData | null> {
  const context = getOracleHcmContext(url);
  if (!context) return null;

  const apiUrl = `${context.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?finder=ById;Id=${encodeURIComponent(context.jobId)}&onlyData=true`;
  const payload = await fetchJson(apiUrl);
  if (!isRecord(payload) || !Array.isArray(payload.items) || !isRecord(payload.items[0])) {
    return null;
  }

  const item = payload.items[0];
  const description = htmlToText(firstText(item.ExternalDescriptionStr, item.ShortDescriptionStr) ?? "");
  const title = firstText(item.Title, item.JobTitle, item.OtherRequisitionTitle);
  const company =
    cleanCompanyName(firstText(item.LegalEmployer, item.BusinessUnit, item.Organization)) ??
    extractEmployerFromDescription(description);
  const workplace = firstText(item.WorkplaceType, item.WorkplaceTypeCode);
  const primaryLocation = firstText(item.PrimaryLocation, item.PrimaryLocationCountry);
  const remote = isRemoteText(`${workplace ?? ""} ${description}`);
  const location = remote ? "Remote" : cleanLocation(primaryLocation);

  return normalizeParsedJob({
    company_name: company,
    job_title: title,
    location,
    is_remote: remote,
    source: "embedded-json",
    confidence: title && (company || location || remote) ? "high" : "medium",
  });
}

function getOracleHcmContext(url: string): { origin: string; jobId: string } | null {
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.hostname.toLowerCase().includes("oraclecloud.com")) return null;

    const match = parsedUrl.pathname.match(/\/hcmUI\/CandidateExperience\/.+?\/job\/([^/?#]+)/i);
    if (!match?.[1]) return null;

    return { origin: parsedUrl.origin, jobId: decodeURIComponent(match[1]) };
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) return null;

    return JSON.parse(await response.text());
  } catch {
    return null;
  }
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
    const companyFromSubdomain = extractCompanyFromOwnedJobHost(url) ?? extractCompanyFromHost(host);
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

function applyBoardSpecificCorrections(job: ParsedJobData, html: string, finalUrl: string): ParsedJobData {
  const genericJob = applyGenericPageCorrections(job, html, finalUrl);

  if (!isWorkdayUrl(finalUrl)) return genericJob;

  const meta = getMetaMap(html);
  const description =
    meta.get("og:description") ??
    meta.get("twitter:description") ??
    meta.get("description") ??
    "";
  const workdayContext = extractWorkdayContext(html);
  const workdayLocation = extractWorkdayLocation(finalUrl, description, genericJob.location);
  const isHybridOrOffice = isHybridOrOfficeText(`${description} ${workdayLocation ?? ""}`);
  const isRemote = !isHybridOrOffice && isRemoteText(`${genericJob.is_remote ? "remote" : ""} ${genericJob.location ?? ""}`);
  const company =
    extractCompanyFromWorkdayText(description, workdayContext.siteId) ??
    extractCompanyFromWorkdayHost(finalUrl) ??
    cleanCompanyName(workdayContext.tenant) ??
    genericJob.company_name;

  return normalizeParsedJob({
    ...genericJob,
    company_name: company,
    location: isRemote ? "Remote" : workdayLocation ?? genericJob.location,
    is_remote: isRemote,
    confidence: bestConfidence(genericJob.confidence, company && workdayLocation ? "high" : "medium"),
  });
}

function finaliseParsedJob(
  job: ParsedJobData,
  candidates: ParsedJobData[],
  html: string,
  finalUrl: string,
): ParsedJobData {
  const meta = getMetaMap(html);
  const titleText =
    meta.get("og:title") ??
    meta.get("twitter:title") ??
    extractTitleTag(html) ??
    "";
  const description =
    meta.get("og:description") ??
    meta.get("twitter:description") ??
    meta.get("description") ??
    "";

  const company = chooseBestCompany([
    job.company_name,
    ...candidates.map((candidate) => candidate.company_name),
    extractEmployerFromDescription(description),
    extractCompanyFromVisibleHtml(html),
    extractFromUrlPattern(finalUrl).company_name,
    extractCompanyFromOwnedJobHost(finalUrl),
  ], finalUrl);
  const location = chooseBestLocation([
    job.location,
    ...candidates.map((candidate) => candidate.location),
    extractLocationFromText(titleText),
    extractLocationFromText(description),
    extractLocationFromText(html),
  ]);
  const title = chooseBestTitle([
    job.job_title,
    ...candidates.map((candidate) => candidate.job_title),
    parseTitleAndCompany(titleText, null, meta).title,
    extractTitleFromVisibleHtml(html),
    extractTitleFromUrl(finalUrl),
  ], company, location);
  const physicalLocation = location && !isRemoteText(location) ? location : null;
  const remote = !physicalLocation && (
    job.is_remote ||
    candidates.some((candidate) => candidate.is_remote) ||
    isRemoteText(`${titleText} ${description}`)
  );

  return normalizeParsedJob({
    ...job,
    company_name: company,
    job_title: title,
    location: remote ? "Remote" : physicalLocation,
    is_remote: remote,
    confidence: bestConfidence(job.confidence, company && title && (physicalLocation || remote) ? "high" : "medium"),
  });
}

function chooseBestCompany(values: Array<string | null | undefined>, finalUrl: string): string | null {
  for (const value of values) {
    const company = cleanCompanyName(value);
    if (!company) continue;
    if (isKnownJobBoardCompany(company, finalUrl)) continue;
    if (isSuspiciousCompany(company)) continue;
    return company;
  }

  return null;
}

function chooseBestTitle(
  values: Array<string | null | undefined>,
  company: string | null,
  location: string | null,
): string | null {
  for (const value of values) {
    const title = stripLocationFromTitle(cleanJobTitle(value), location);
    if (!title) continue;
    if (isSuspiciousJobTitle(title, company)) continue;
    return title;
  }

  return null;
}

function chooseBestLocation(values: Array<string | null | undefined>): string | null {
  let remote: string | null = null;

  for (const value of values) {
    const location = cleanLocation(value);
    if (!location) continue;
    if (isRemoteText(location)) {
      remote ??= "Remote";
      continue;
    }
    if (!isSuspiciousLocation(location)) return location;
  }

  return remote;
}

function applyGenericPageCorrections(job: ParsedJobData, html: string, finalUrl: string): ParsedJobData {
  const meta = getMetaMap(html);
  const title =
    meta.get("og:title") ??
    meta.get("twitter:title") ??
    extractTitleTag(html) ??
    "";
  const description =
    meta.get("og:description") ??
    meta.get("twitter:description") ??
    meta.get("description") ??
    "";
  const location = job.location ?? extractLocationFromText(title) ?? extractLocationFromText(description) ?? extractLocationFromText(html);
  const company =
    job.company_name && !isKnownJobBoardCompany(job.company_name, finalUrl)
      ? job.company_name
      : extractEmployerFromDescription(description) ??
        extractCompanyFromOwnedJobHost(finalUrl);
  const jobTitle = stripLocationFromTitle(job.job_title, location);

  return normalizeParsedJob({
    ...job,
    company_name: company,
    job_title: jobTitle,
    location,
    confidence: bestConfidence(job.confidence, company && jobTitle ? "medium" : "low"),
  });
}

function extractEmployerFromDescription(description: string): string | null {
  const cleaned = normalizeText(description);
  const patterns = [
    /\bAt\s+([A-Z][A-Za-z0-9&.' -]+?),\s+(?:we|we're|our|you|the)\b/,
    /\bJoin (?:our|the) team and become a part of\s+([A-Z][A-Za-z0-9&.' -]+)\s+(?:community|team|organization|department)\b/i,
    /\bJoin (?:our|the) team at\s+([A-Z][A-Za-z0-9&.' -]+?)(?:[.;]|$)/i,
    /\bbecome a part of\s+([A-Z][A-Za-z0-9&.' -]+)\s+(?:community|team|organization|department)\b/i,
    /\bApply for .+? (?:at|with)\s+([A-Z][A-Za-z0-9&.' -]+?)(?:[.;]|$)/i,
    /\b([A-Z][A-Za-z0-9&.' -]+?)\s+is (?:seeking|hiring|looking for|accepting applications)\b/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const company = cleanCompanyName(match?.[1] ?? null);
    if (company && !isGenericCompanyPhrase(company)) return company;
  }

  return null;
}

function extractCompanyFromVisibleHtml(html: string): string | null {
  const text = htmlToText(html).slice(0, 250_000);
  const patterns = [
    /\b(?:Company|Employer|Organization|Agency|Department)\s*[:\-]\s*([A-Z][A-Za-z0-9&.' -]{2,80})(?:\b|[|.;])/i,
    /\bJob posted by\s+([A-Z][A-Za-z0-9&.' -]{2,80})(?:\b|[|.;])/i,
    /\bHiring organization\s*[:\-]\s*([A-Z][A-Za-z0-9&.' -]{2,80})(?:\b|[|.;])/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const company = cleanCompanyName(match?.[1] ?? null);
    if (company && !isGenericCompanyPhrase(company)) return company;
  }

  return null;
}

function extractTitleFromVisibleHtml(html: string): string | null {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const fromHeading = cleanJobTitle(htmlToText(heading ?? ""));
  if (fromHeading) return fromHeading;

  const text = htmlToText(html).slice(0, 120_000);
  const patterns = [
    /\b(?:Job title|Position|Role)\s*[:\-]\s*([A-Z][A-Za-z0-9/&+.,'() -]{2,120})(?:\b|[|.;])/i,
    /\bNow hiring\s*[:\-]\s*([A-Z][A-Za-z0-9/&+.,'() -]{2,120})(?:\b|[|.;])/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const title = cleanJobTitle(match?.[1] ?? null);
    if (title) return title;
  }

  return null;
}

function htmlToText(value: string): string {
  return normalizeText(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(?:p|div|li|h1|h2|h3|tr)>/gi, ". ")
      .replace(/<[^>]+>/g, " "),
  );
}

function stripLocationFromTitle(title: string | null, location: string | null): string | null {
  if (!title || !location) return title;

  const escapedLocation = location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const locationPattern = new RegExp(`\\s+in\\s+${escapedLocation}\\s*$`, "i");
  const cleaned = title.replace(locationPattern, "").trim();
  return cleanJobTitle(cleaned);
}

function isWorkdayUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes("myworkdayjobs.com");
  } catch {
    return false;
  }
}

function extractWorkdayContext(html: string): { tenant: string | null; siteId: string | null } {
  return {
    tenant: readJsStringField(html, "tenant"),
    siteId: readJsStringField(html, "siteId"),
  };
}

function extractCompanyFromWorkdayHost(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const tenant = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/)?.[1];
    if (!tenant) return null;

    return cleanCompanyName(tenant);
  } catch {
    return null;
  }
}

function readJsStringField(text: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\b${escapedKey}\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(text);
  if (!match) return null;

  try {
    return normalizeText(JSON.parse(`"${match[1]}"`));
  } catch {
    return normalizeText(unescapeJsString(match[1]));
  }
}

function extractCompanyFromWorkdayText(description: string, siteId: string | null): string | null {
  const cleaned = normalizeText(description);
  const patterns = [
    /\b(?:at|At)\s+([A-Z][A-Za-z0-9&.' -]+?),\s+(?:our|you|we|the|a career|you'll|you will)\b/,
    /\bA career at\s+([A-Z][A-Za-z0-9&.' -]+?)\s+means\b/i,
    /\bAs a wholly owned subsidiary of\s+([A-Z][A-Za-z0-9&.' -]+?),\s+([A-Z][A-Za-z0-9&.' -]+?)\s+(?:continues|is|has|focuses)\b/i,
    /\b([A-Z][A-Za-z0-9&.' -]+?)\s+is an Equal Employment Opportunity employer\b/,
    /\b([A-Z][A-Za-z0-9&.' -]+?)\s+has a strong history\b/,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const value = cleanCompanyName(match?.[2] ?? match?.[1] ?? null);
    if (value && !isGenericCompanyPhrase(value)) return value;
  }

  const fromSiteId = siteId
    ?.replace(/careers?/gi, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return cleanCompanyName(fromSiteId);
}

function isGenericCompanyPhrase(value: string): boolean {
  return /^(the opportunity|description|job responsibilities|minimum requirements|why join us)$/i.test(value);
}

function isSuspiciousCompany(value: string): boolean {
  return (
    value.length < 2 ||
    value.length > 90 ||
    /\b(apply|login|sign in|privacy|terms|job details|career programs|resources)\b/i.test(value) ||
    /\.(com|org|net|io|jobs|careers)\b/i.test(value) ||
    /^\d+$/.test(value)
  );
}

function isSuspiciousJobTitle(value: string, company: string | null): boolean {
  return (
    value.length < 2 ||
    value.length > 160 ||
    (company ? normForCompare(value) === normForCompare(company) : false) ||
    /\b(apply now|job details|privacy|terms|sign in|login|all jobs|job search)\b/i.test(value) ||
    /^job\s*id\b/i.test(value)
  );
}

function isSuspiciousLocation(value: string): boolean {
  return (
    value.length < 3 ||
    value.length > 80 ||
    /\b(salary|compensation|benefits|apply|posted|category|department|description|responsibilities)\b/i.test(value) ||
    /\b(input|textarea|select|application-question|location-input|eeo-survey)\b/i.test(value) ||
    /[{}<>;]/.test(value) ||
    /(?:^|,)\s*\.[a-z][\w-]*/i.test(value) ||
    /\d{4,}/.test(value)
  );
}

function normForCompare(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isKnownJobBoardCompany(value: string | null | undefined, url?: string): boolean {
  const normalized = normalizeText(value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
  if (!normalized) return false;

  const knownNames = [
    "governmentjobs",
    "governmentjobscom",
    "schooljobs",
    "schooljobscom",
    "neogov",
    "ats",
    "linkedin",
    "indeed",
    "greenhouse",
    "lever",
    "workday",
    "ashby",
    "jobvite",
    "smartrecruiters",
    "recruitee",
    "bamboohr",
    "icims",
  ];

  if (knownNames.includes(normalized)) return true;

  if (!url) return false;
  try {
    const ownedHostCompany = extractCompanyFromOwnedJobHost(url);
    if (ownedHostCompany && normalized === normForCompare(ownedHostCompany)) return false;

    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const hostRoot = host.split(".")[0]?.replace(/[^a-z0-9]+/g, "");
    if (host.includes("myworkdayjobs.com") && hostRoot && normalized === hostRoot) return false;
    return Boolean(hostRoot && normalized === hostRoot && KNOWN_BOARD_SUFFIXES.some((suffix) => host.includes(suffix)));
  } catch {
    return false;
  }
}

function extractCompanyFromOwnedJobHost(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length < 2) return null;

    const root = parts[0];
    const second = parts[1];
    const genericRoots = new Set(["ats", "jobs", "careers", "apply", "boards", "recruiting", "www"]);
    if (genericRoots.has(root)) return null;

    const companyOwned =
      second === "jobs" ||
      second === "careers" ||
      host.endsWith(".jobs") ||
      host.endsWith(".careers");

    return companyOwned ? humanizeSlug(root) : null;
  } catch {
    return null;
  }
}

function extractWorkdayLocation(finalUrl: string, description: string, fallbackLocation: string | null): string | null {
  const fromPath = extractLocationFromWorkdayPath(finalUrl);
  if (fromPath) return fromPath;

  const fromDescription =
    extractOfficeLocationFromText(description) ??
    extractLocationFromText(description);
  if (fromDescription) return fromDescription;

  return fallbackLocation && !isRemoteText(fallbackLocation) ? fallbackLocation : null;
}

function extractLocationFromWorkdayPath(url: string): string | null {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const jobIndex = path.split("/").findIndex((segment) => segment.toLowerCase() === "job");
    const segment = jobIndex >= 0 ? path.split("/")[jobIndex + 1] : null;
    if (!segment || !/[A-Za-z]/.test(segment) || !segment.includes("-")) return null;

    const cleaned = segment
      .replace(/-\d+.*$/g, "")
      .replace(/_/g, "-");
    const cityState = cleaned.match(/^([A-Za-z][A-Za-z.-]+(?:-[A-Za-z][A-Za-z.-]+)*)-([A-Z]{2})$/);
    if (cityState) {
      return cleanLocation(`${humanizeSlug(cityState[1])}, ${cityState[2]}`);
    }

    return cleanLocation(humanizeSlug(cleaned));
  } catch {
    return null;
  }
}

function extractOfficeLocationFromText(text: string): string | null {
  const cleaned = normalizeText(text);
  const patterns = [
    /\bbased out of (?:our|the)\s+(?:downtown\s+)?([A-Z][A-Za-z .'-]+)\s+office\b/i,
    /\bin (?:our|the)\s+(?:downtown\s+)?([A-Z][A-Za-z .'-]+)\s+office\b/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const location = cleanLocation(match?.[1] ?? null);
    if (location) return location;
  }

  return null;
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
    const content = attrs.content ?? attrs.value;
    if (key && content && !meta.has(key)) meta.set(key, decodeHtmlEntities(content));
  }

  return meta;
}

function extractMetaLabelValue(meta: Map<string, string>, label: string): string | null {
  const wanted = label.toLowerCase();

  for (let index = 1; index <= 8; index += 1) {
    const metaLabel =
      meta.get(`twitter:label${index}`) ??
      meta.get(`og:label${index}`) ??
      meta.get(`label${index}`);
    const metaValue =
      meta.get(`twitter:data${index}`) ??
      meta.get(`og:data${index}`) ??
      meta.get(`data${index}`);

    if (normalizeText(metaLabel ?? "").toLowerCase() === wanted) {
      return normalizeText(metaValue ?? "") || null;
    }
  }

  return null;
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

function parseTitleAndCompany(
  rawTitle: string | null,
  fallbackCompany: string | null,
  meta?: Map<string, string>,
): { title: string | null; company: string | null } {
  if (!rawTitle) return { title: null, company: fallbackCompany };

  const cleaned = normalizeText(rawTitle)
    .replace(/\b(apply now|careers|jobs|job details|job openings)\b/gi, "")
    .trim();

  if (meta && looksLikeCompanyFirstTitle(rawTitle, meta)) {
    const parts = cleaned.split(/\s+[-\u2013\u2014]\s+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        company: cleanCompanyName(parts[0]),
        title: cleanJobTitle(parts.slice(1).join(" - ")),
      };
    }
  }

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

function looksLikeCompanyFirstTitle(rawTitle: string, meta: Map<string, string>): boolean {
  const title = normalizeText(rawTitle);
  if (!/\s+[-\u2013\u2014]\s+/.test(title)) return false;

  const url = meta.get("og:url") ?? meta.get("twitter:url") ?? "";
  const hasStructuredJobMeta = Boolean(
    extractMetaLabelValue(meta, "location") ||
    extractMetaLabelValue(meta, "team") ||
    extractMetaLabelValue(meta, "department"),
  );

  return /lever\.co/i.test(url) || hasStructuredJobMeta;
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
    /\b(?:jobLocation|dimension8|location)\s*["':=]+\s*"?((?:USA|US|United States),\s*[A-Z]{2},\s*[A-Z][A-Za-z .'-]+)\b/i,
    /\b((?:USA|US|United States),\s*[A-Z]{2},\s*[A-Z][A-Za-z .'-]+)\b/i,
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

function isHybridOrOfficeText(text: string): boolean {
  return /\b(hybrid|on[- ]?site|onsite|in[- ]office|in office|based out of|office)\b/i.test(text);
}

function extractCompanyFromHost(host: string): string | null {
  const parts = host.split(".");
  if (parts.length < 2) return null;

  const first = parts[0];
  const second = parts[1];
  if (["ats", "jobs", "careers", "boards", "apply", "recruiting"].includes(first)) {
    if (second === "employinc") return "Employ";
    return second;
  }
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
    .replace(/^\d+[-_]+/g, "")
    .replace(/-\d+$/g, "")
    .replace(/(?:req|job|jr)-?\d+/gi, "");
}

function extractTitleFromUrl(url: string): string | null {
  try {
    return extractLikelyTitleFromPath(decodeURIComponent(new URL(url).pathname));
  } catch {
    return null;
  }
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
    .replace(/^jobs?\s*at\s*/i, "")
    .replace(/^jobs?at/i, "")
    .replace(/\b(career site|careers|career|jobs|job board|greenhouse|lever|workday|ashby|site)\b/gi, "")
    .replace(/\s+[-|]\s+.*$/g, "")
    .replace(/^[,|.\-\s]+|[,|.\-\s]+$/g, "")
    .trim();

  if (isKnownJobBoardCompany(cleaned)) return null;
  if (/^hpe$/i.test(cleaned)) return "HPE";
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
    .replace(/^(?:based|located)\s+in\s+/i, "")
    .replace(/\b(full[- ]time|part[- ]time|contract|internship|apply now)\b/gi, "")
    .replace(/^[,|.\-\s]+|[,|.\-\s]+$/g, "")
    .trim();

  if (!cleaned || isSuspiciousLocation(cleaned)) return null;

  return normalizeStructuredLocation(cleaned) || formatLocationCasing(cleaned) || null;
}

function normalizeStructuredLocation(value: string): string | null {
  const countryStateCity = value.match(/^(?:USA|US|United States),\s*([A-Z]{2}),\s*([A-Z][A-Za-z .'-]+)$/i);
  if (countryStateCity) {
    return `${toTitleCase(countryStateCity[2])}, ${countryStateCity[1].toUpperCase()}`;
  }

  const cityStateCountry = value.match(/^([A-Z][A-Za-z .'-]+?)[,\s]+([A-Za-z ]+?)(?:,\s*|\s+)(?:United States(?: of America)?|USA|US)$/i);
  if (cityStateCountry) {
    const state = normalizeUsState(cityStateCountry[2]);
    if (state) return `${toTitleCase(cityStateCountry[1])}, ${state}`;
  }

  const cityFullState = value.match(/^([A-Z][A-Za-z .'-]+),\s*([A-Za-z ]+)$/i);
  if (cityFullState) {
    const state = normalizeUsState(cityFullState[2]);
    if (state) return `${toTitleCase(cityFullState[1])}, ${state}`;
  }

  return null;
}

function normalizeUsState(value: string): string | null {
  const cleaned = normalizeText(value).toLowerCase();
  if (/^[a-z]{2}$/i.test(cleaned)) return cleaned.toUpperCase();
  return US_STATE_ABBREVIATIONS[cleaned] ?? null;
}

function formatLocationCasing(value: string): string {
  const stateMatch = value.match(/^([A-Z][A-Z .'-]+),\s*([A-Z]{2})(.*)$/);
  if (!stateMatch) return value;

  return `${toTitleCase(stateMatch[1])}, ${stateMatch[2]}${stateMatch[3] ?? ""}`.trim();
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase());
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
