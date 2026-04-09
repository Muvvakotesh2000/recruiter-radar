import dns from "dns/promises";
import net from "net";
import { cacheGet, cacheSet, acquireLock, TTL } from "./cache";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmailStatus = "verified" | "invalid" | "catch_all_domain" | "unknown";

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

// ─── Syntax ───────────────────────────────────────────────────────────────────

export function isValidSyntax(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

// ─── Layer 1: MX (Redis-cached) ──────────────────────────────────────────────

export async function getMxHost(domain: string): Promise<string | null> {
  const key = `mx:${domain}`;
  const cached = await cacheGet<string | null>(key);
  if (cached !== null) return cached;  // includes cached-null ("no MX")

  try {
    const records = await dns.resolveMx(domain);
    if (!records?.length) { await cacheSet(key, null, TTL.MX); return null; }
    records.sort((a, b) => a.priority - b.priority);
    const host = records[0].exchange;
    await cacheSet(key, host, TTL.MX);
    return host;
  } catch {
    await cacheSet(key, null, TTL.MX);
    return null;
  }
}

// ─── Layer 2+3+4: SMTP (single TCP session, all emails + catch-all probe) ────

type RawResult = "accepted" | "rejected" | "unknown";

interface SmtpOutput {
  blocked: boolean;
  catchAll: boolean;
  results: Record<string, RawResult>;
}

export function smtpBulkCheck(emails: string[], domain: string, mxHost: string): Promise<SmtpOutput> {
  return new Promise((resolve) => {
    const probe = `probe_${Math.random().toString(36).slice(2, 12)}@${domain}`;
    const queue = [...emails, probe];
    const raw: Record<string, RawResult> = {};
    queue.forEach((e) => (raw[e] = "unknown"));

    let resolved = false;
    let buf = "";
    let stage = 0;
    let idx = 0;

    const finish = (blocked: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* ignore */ }
      const catchAll = raw[probe] === "accepted";
      const results: Record<string, RawResult> = {};
      emails.forEach((e) => (results[e] = raw[e]));
      resolve({ blocked, catchAll, results });
    };

    const timer = setTimeout(() => finish(true), 12000);
    const sock = net.createConnection({ port: 25, host: mxHost });

    const next = () => idx < queue.length
      ? sock.write(`RCPT TO:<${queue[idx]}>\r\n`)
      : (sock.write("QUIT\r\n"), finish(false));

    sock.on("data", (chunk) => {
      buf += chunk.toString("ascii");
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        const code = line.slice(0, 3);
        if (line.length >= 4 && line[3] !== " ") continue; // multi-line continuation

        switch (stage) {
          case 0: code === "220" ? (stage = 1, sock.write("EHLO validator.local\r\n")) : finish(false); break;
          case 1: code === "250" ? (stage = 2, sock.write("MAIL FROM:<probe@validator.local>\r\n")) : finish(false); break;
          case 2: code === "250" ? (stage = 3, next()) : finish(false); break;
          default:
            if (code === "250") raw[queue[idx]] = "accepted";
            else if (code[0] === "5") raw[queue[idx]] = "rejected";
            idx++;
            next();
        }
      }
    });

    sock.on("error", () => finish(true));
    sock.on("close", () => { if (!resolved) finish(false); });
  });
}

// ─── Pattern rank for sorting survivors ──────────────────────────────────────

function patternRank(email: string, first: string, last: string): number {
  const local = email.split("@")[0].toLowerCase();
  const f = first.toLowerCase(), l = last.toLowerCase();
  const patterns: [string, number][] = [
    [`${f}.${l}`, 1], [`${f}${l}`, 2], [`${f[0]}${l}`, 3],
    [`${f}${l[0]}`, 4], [`${f[0]}.${l}`, 5], [f, 6],
    [l, 7], [`${l}.${f}`, 8], [`${l}${f}`, 9],
  ];
  return patterns.find(([p]) => p === local)?.[1] ?? 99;
}

// ─── Public: validate a batch ────────────────────────────────────────────────
// Concurrency strategy:
//   1. Check Redis cache for each email and catch-all flag
//   2. Acquire a Redis distributed lock per domain
//   3. Re-check cache inside lock (another worker may have just finished)
//   4. Run SMTP only for truly uncached emails
//   5. Store results and release lock

export async function validateBatch(
  domain: string,
  emails: string[],
  firstName: string,
  lastName: string,
): Promise<BatchResult> {
  const valid = emails.filter(isValidSyntax);

  const mxHost = await getMxHost(domain);
  if (!mxHost) {
    return {
      domain, is_catch_all: false, mx_found: false, smtp_blocked: false,
      results: valid.map((e) => ({ email: e, status: "invalid", confidence: "high" })),
      recommended_email: null,
    };
  }

  // Fast path: everything cached
  const smtpResults: Record<string, RawResult> = {};
  for (const e of valid) {
    const hit = await cacheGet<RawResult>(`email:${e}`);
    if (hit) smtpResults[e] = hit;
  }
  let catchAll = await cacheGet<boolean>(`catchall:${domain}`);
  let smtpBlocked = false;

  const uncached = valid.filter((e) => !smtpResults[e]);

  if (uncached.length > 0 || catchAll === null) {
    // Acquire distributed lock — one SMTP session per domain across all worker instances
    let release = await acquireLock(`smtp:${domain}`, 30);

    if (!release) {
      // Another worker holds the lock — wait up to 15s then re-check cache
      await new Promise((r) => setTimeout(r, 15000));
      for (const e of uncached) {
        const hit = await cacheGet<RawResult>(`email:${e}`);
        if (hit) smtpResults[e] = hit;
      }
      catchAll = await cacheGet<boolean>(`catchall:${domain}`);
    } else {
      try {
        // Re-check inside lock
        const stillUncached = uncached.filter(async (e) => {
          const hit = await cacheGet<RawResult>(`email:${e}`);
          if (hit) { smtpResults[e] = hit; return false; }
          return true;
        });
        catchAll = await cacheGet<boolean>(`catchall:${domain}`);

        const probeEmails = uncached.length > 0 ? uncached : [valid[0]];
        const smtp = await smtpBulkCheck(probeEmails, domain, mxHost);
        smtpBlocked = smtp.blocked;

        if (!smtpBlocked) {
          catchAll = smtp.catchAll;
          await cacheSet(`catchall:${domain}`, catchAll, TTL.CATCH_ALL);
          for (const [e, r] of Object.entries(smtp.results)) {
            smtpResults[e] = r;
            await cacheSet(`email:${e}`, r, TTL.EMAIL);
          }
        }
      } finally {
        await release();
      }
      void stillUncached; // suppress unused warning
    }
  }

  catchAll = catchAll ?? false;

  const results: EmailResult[] = valid
    .map((email): EmailResult => {
      const raw = smtpResults[email] ?? "unknown";
      const status: EmailStatus =
        catchAll ? "catch_all_domain"
        : smtpBlocked || raw === "unknown" ? "unknown"
        : raw === "accepted" ? "verified"
        : "invalid";
      const confidence: EmailResult["confidence"] =
        status === "verified" || status === "invalid" ? "high"
        : status === "catch_all_domain" ? "low" : "medium";
      return { email, status, confidence };
    })
    .sort((a, b) => {
      const order = (s: EmailStatus) =>
        s === "verified" ? 0 : s === "unknown" ? 1 : s === "catch_all_domain" ? 2 : 3;
      if (order(a.status) !== order(b.status)) return order(a.status) - order(b.status);
      return patternRank(a.email, firstName, lastName) - patternRank(b.email, firstName, lastName);
    });

  return {
    domain, is_catch_all: catchAll, mx_found: true, smtp_blocked: smtpBlocked,
    results,
    recommended_email:
      results.find((r) => r.status === "verified")?.email ??
      results.find((r) => r.status !== "invalid")?.email ?? null,
  };
}
