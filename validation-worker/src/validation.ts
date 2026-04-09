import dns from "dns/promises";
import net from "net";
import { cacheGet, cacheSet, TTL } from "./cache";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmailStatus =
  | "verified"         // SMTP accepted, not catch-all
  | "invalid"          // SMTP 5xx rejected
  | "catch_all_domain" // server accepts any address
  | "unknown";         // timeout / greylisting / blocked

export interface EmailResult {
  email: string;
  status: EmailStatus;
  confidence: "high" | "medium" | "low";
}

export interface BatchResult {
  domain: string;
  is_catch_all: boolean;
  mx_found: boolean;
  smtp_blocked: boolean;
  results: EmailResult[];
  recommended_email: string | null;
}

// ─── Pattern prevalence for ranking ──────────────────────────────────────────

const PATTERN_RANK: Record<string, number> = {
  "first.last": 1, "firstlast": 2, "flast": 3,
  "firstl": 4,     "f.last": 5,    "first": 6,
  "last": 7,       "last.first": 8, "lastfirst": 9,
};

// ─── Syntax ───────────────────────────────────────────────────────────────────

export function isValidSyntax(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

// ─── Layer 1: MX lookup (cached) ─────────────────────────────────────────────

export async function getMxHost(domain: string): Promise<string | null> {
  const key = `mx:${domain}`;
  const cached = cacheGet<string | null>(key);
  if (cached !== undefined) return cached;   // null = "no MX" is still a valid cached value

  try {
    const records = await dns.resolveMx(domain);
    if (!records?.length) { cacheSet(key, null, TTL.MX); return null; }
    records.sort((a, b) => a.priority - b.priority);
    const host = records[0].exchange;
    cacheSet(key, host, TTL.MX);
    return host;
  } catch {
    cacheSet(key, null, TTL.MX);
    return null;
  }
}

// ─── Per-domain SMTP lock ─────────────────────────────────────────────────────
// Ensures only ONE SMTP session runs per domain at a time.
// Concurrent requests for the same domain queue up, then find results in cache.

const domainLocks = new Map<string, Promise<void>>();

async function withDomainLock<T>(domain: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any existing session on this domain to finish
  const existing = domainLocks.get(domain);
  if (existing) await existing.catch(() => { /* ignore errors from previous session */ });

  let release!: () => void;
  const lock = new Promise<void>((resolve) => { release = resolve; });
  domainLocks.set(domain, lock);

  try {
    return await fn();
  } finally {
    release();
    domainLocks.delete(domain);
  }
}

// ─── Layer 2+3+4: SMTP bulk check + catch-all ────────────────────────────────

type RawResult = "accepted" | "rejected" | "unknown";

interface SmtpBulkOutput {
  blocked: boolean;
  catchAll: boolean;
  results: Record<string, RawResult>;
}

function smtpBulkCheck(emails: string[], domain: string, mxHost: string): Promise<SmtpBulkOutput> {
  return new Promise((resolve) => {
    const randomEmail = `probe_${Math.random().toString(36).slice(2, 12)}@${domain}`;
    const queue = [...emails, randomEmail];
    const raw: Record<string, RawResult> = {};
    queue.forEach((e) => (raw[e] = "unknown"));

    let resolved = false;
    let buffer = "";
    let stage = 0;
    let idx = 0;

    const finish = (blocked: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* ignore */ }

      const catchAll = raw[randomEmail] === "accepted";
      const results: Record<string, RawResult> = {};
      emails.forEach((e) => (results[e] = raw[e]));

      resolve({ blocked, catchAll, results });
    };

    const timer = setTimeout(() => finish(true), 12000);
    const socket = net.createConnection({ port: 25, host: mxHost });

    const nextRcpt = () => {
      if (idx < queue.length) socket.write(`RCPT TO:<${queue[idx]}>\r\n`);
      else { socket.write("QUIT\r\n"); finish(false); }
    };

    socket.on("data", (chunk) => {
      buffer += chunk.toString("ascii");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        const code = line.slice(0, 3);
        const final = line.length < 4 || line[3] === " ";
        if (!final) continue;

        switch (stage) {
          case 0:
            if (code === "220") { stage = 1; socket.write("EHLO validator.local\r\n"); }
            else finish(false);
            break;
          case 1:
            if (code === "250") { stage = 2; socket.write("MAIL FROM:<probe@validator.local>\r\n"); }
            else finish(false);
            break;
          case 2:
            if (code === "250") { stage = 3; nextRcpt(); }
            else finish(false);
            break;
          default: {
            const email = queue[idx];
            if (code === "250") raw[email] = "accepted";
            else if (code[0] === "5") raw[email] = "rejected";
            idx++;
            nextRcpt();
            break;
          }
        }
      }
    });

    socket.on("error", () => finish(true));
    socket.on("close", () => { if (!resolved) finish(false); });
  });
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

function patternRank(email: string, first: string, last: string): number {
  const local = email.split("@")[0].toLowerCase();
  const f = first.toLowerCase();
  const l = last.toLowerCase();
  if (local === `${f}.${l}`) return PATTERN_RANK["first.last"];
  if (local === `${f}${l}`)  return PATTERN_RANK["firstlast"];
  if (local === `${f[0]}${l}`) return PATTERN_RANK["flast"];
  if (local === `${f}${l[0]}`) return PATTERN_RANK["firstl"];
  if (local === `${f[0]}.${l}`) return PATTERN_RANK["f.last"];
  if (local === f)             return PATTERN_RANK["first"];
  if (local === l)             return PATTERN_RANK["last"];
  if (local === `${l}.${f}`) return PATTERN_RANK["last.first"];
  if (local === `${l}${f}`)  return PATTERN_RANK["lastfirst"];
  return 99;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function validateBatch(
  domain: string,
  emails: string[],
  firstName: string,
  lastName: string,
): Promise<BatchResult> {
  const valid = emails.filter(isValidSyntax);

  // MX check (cached)
  const mxHost = await getMxHost(domain);
  if (!mxHost) {
    return {
      domain, is_catch_all: false, mx_found: false, smtp_blocked: false,
      results: valid.map((e) => ({ email: e, status: "invalid", confidence: "high" })),
      recommended_email: null,
    };
  }

  // ── Concurrency-safe SMTP section ───────────────────────────────────────────
  // 1. Separate emails into cached vs uncached
  // 2. Acquire per-domain lock for the uncached ones
  // 3. Re-check cache inside the lock (another request may have filled it)
  // 4. Run SMTP only for truly uncached emails
  // 5. Release lock — other waiters will now find everything in cache

  let catchAll = cacheGet<boolean>(`catchall:${domain}`);
  let smtpBlocked = false;
  const smtpResults: Record<string, RawResult> = {};

  // Pre-fill from cache
  const needsCheck = valid.filter((e) => {
    const hit = cacheGet<RawResult>(`email:${e}`);
    if (hit !== null) { smtpResults[e] = hit!; return false; }
    return true;
  });

  const needsCatchAll = catchAll === null;

  if (needsCheck.length > 0 || needsCatchAll) {
    await withDomainLock(domain, async () => {
      // Re-check cache inside lock — a concurrent request may have just finished
      const stillNeeded = needsCheck.filter((e) => {
        const hit = cacheGet<RawResult>(`email:${e}`);
        if (hit !== null) { smtpResults[e] = hit!; return false; }
        return true;
      });

      catchAll = cacheGet<boolean>(`catchall:${domain}`);

      if (stillNeeded.length === 0 && catchAll !== null) return; // everything cached now

      // Use at least one email so we can detect catch-all even if all emails are cached
      const probeEmails = stillNeeded.length > 0 ? stillNeeded : [valid[0]];
      const smtp = await smtpBulkCheck(probeEmails, domain, mxHost);
      smtpBlocked = smtp.blocked;

      if (!smtpBlocked) {
        catchAll = smtp.catchAll;
        cacheSet(`catchall:${domain}`, catchAll, TTL.CATCH_ALL);

        for (const [email, result] of Object.entries(smtp.results)) {
          smtpResults[email] = result;
          cacheSet(`email:${email}`, result, TTL.EMAIL);
        }
      }
    });
  }

  catchAll = catchAll ?? false;

  // Build final results
  const results: EmailResult[] = valid
    .map((email): EmailResult => {
      const raw = smtpResults[email] ?? "unknown";
      let status: EmailStatus;
      if (catchAll)                          status = "catch_all_domain";
      else if (smtpBlocked || raw === "unknown") status = "unknown";
      else if (raw === "accepted")           status = "verified";
      else                                   status = "invalid";

      const confidence: EmailResult["confidence"] =
        status === "verified" || status === "invalid" ? "high"
        : status === "catch_all_domain" ? "low"
        : "medium";

      return { email, status, confidence };
    })
    .sort((a, b) => {
      // verified first, invalid last, then by pattern rank
      const order = (s: EmailStatus) =>
        s === "verified" ? 0 : s === "unknown" ? 1 : s === "catch_all_domain" ? 2 : 3;
      if (order(a.status) !== order(b.status)) return order(a.status) - order(b.status);
      return patternRank(a.email, firstName, lastName) - patternRank(b.email, firstName, lastName);
    });

  const recommended =
    results.find((r) => r.status === "verified")?.email ??
    results.find((r) => r.status !== "invalid")?.email ??
    null;

  return { domain, is_catch_all: catchAll, mx_found: true, smtp_blocked: smtpBlocked, results, recommended_email: recommended };
}
