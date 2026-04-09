import dns from "dns/promises";
import net from "net";
import { cacheGet, cacheSet, TTL } from "./cache";

export type EmailStatus =
  | "verified"       // SMTP accepted, not catch-all
  | "invalid"        // SMTP 5xx rejected
  | "catch_all_domain" // server accepts any address
  | "unknown";       // timeout, greylisting, blocked

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
  "first.last": 1,
  "firstlast":  2,
  "flast":      3,
  "firstl":     4,
  "f.last":     5,
  "first":      6,
  "last":       7,
  "last.first": 8,
  "lastfirst":  9,
};

// ─── Layer 1: Syntax ─────────────────────────────────────────────────────────

export function isValidSyntax(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

// ─── Layer 2: MX lookup (cached) ─────────────────────────────────────────────

export async function getMxHost(domain: string): Promise<string | null> {
  const cacheKey = `mx:${domain}`;
  const cached = cacheGet<string | null>(cacheKey);
  if (cached !== null) return cached;   // null means "no MX" — still a cache hit

  try {
    const records = await dns.resolveMx(domain);
    if (!records?.length) {
      cacheSet(cacheKey, null, TTL.MX);
      return null;
    }
    records.sort((a, b) => a.priority - b.priority);
    const host = records[0].exchange;
    cacheSet(cacheKey, host, TTL.MX);
    return host;
  } catch {
    cacheSet(cacheKey, null, TTL.MX);
    return null;
  }
}

// ─── Layer 3+4: SMTP bulk check + catch-all detection ────────────────────────

interface SmtpBulkResult {
  blocked: boolean;
  catchAll: boolean;
  results: Record<string, "accepted" | "rejected" | "unknown">;
}

function smtpBulkCheck(emails: string[], domain: string, mxHost: string): Promise<SmtpBulkResult> {
  return new Promise((resolve) => {
    const randomEmail = `probe_${Math.random().toString(36).slice(2, 12)}@${domain}`;
    const queue = [...emails, randomEmail];
    const raw: Record<string, "accepted" | "rejected" | "unknown"> = {};
    emails.forEach((e) => (raw[e] = "unknown"));
    raw[randomEmail] = "unknown";

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
      const results: Record<string, "accepted" | "rejected" | "unknown"> = {};
      emails.forEach((e) => (results[e] = raw[e]));

      resolve({ blocked, catchAll, results });
    };

    const timer = setTimeout(() => finish(true), 12000);
    const socket = net.createConnection({ port: 25, host: mxHost });

    const nextRcpt = () => {
      if (idx < queue.length) {
        socket.write(`RCPT TO:<${queue[idx]}>\r\n`);
      } else {
        socket.write("QUIT\r\n");
        finish(false);
      }
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

// ─── Layer 5: Ranking ─────────────────────────────────────────────────────────

function rankLabel(email: string, firstName: string, lastName: string): number {
  const local = email.split("@")[0].toLowerCase();
  const f = firstName.toLowerCase();
  const l = lastName.toLowerCase();

  // Match local part against known pattern shapes
  if (local === `${f}.${l}`) return PATTERN_RANK["first.last"];
  if (local === `${f}${l}`) return PATTERN_RANK["firstlast"];
  if (local === `${f[0]}${l}`) return PATTERN_RANK["flast"];
  if (local === `${f}${l[0]}`) return PATTERN_RANK["firstl"];
  if (local === `${f[0]}.${l}`) return PATTERN_RANK["f.last"];
  if (local === f) return PATTERN_RANK["first"];
  if (local === l) return PATTERN_RANK["last"];
  if (local === `${l}.${f}`) return PATTERN_RANK["last.first"];
  if (local === `${l}${f}`) return PATTERN_RANK["lastfirst"];
  return 99;
}

// ─── Public: validate a batch ────────────────────────────────────────────────

export async function validateBatch(
  domain: string,
  emails: string[],
  firstName: string,
  lastName: string
): Promise<BatchResult> {
  // Syntax filter
  const valid = emails.filter(isValidSyntax);

  // MX
  const mxHost = await getMxHost(domain);
  if (!mxHost) {
    return {
      domain,
      is_catch_all: false,
      mx_found: false,
      smtp_blocked: false,
      results: valid.map((e) => ({ email: e, status: "invalid", confidence: "high" })),
      recommended_email: null,
    };
  }

  // Check per-email cache
  const uncachedEmails: string[] = [];
  const cachedResults: Record<string, "accepted" | "rejected" | "unknown"> = {};

  for (const email of valid) {
    const hit = cacheGet<"accepted" | "rejected" | "unknown">(`email:${email}`);
    if (hit !== null) cachedResults[email] = hit;
    else uncachedEmails.push(email);
  }

  // Check catch-all cache
  let catchAll = cacheGet<boolean>(`catchall:${domain}`);
  let smtpBlocked = false;
  const smtpResults: Record<string, "accepted" | "rejected" | "unknown"> = { ...cachedResults };

  if (uncachedEmails.length > 0 || catchAll === null) {
    const smtp = await smtpBulkCheck(
      uncachedEmails.length > 0 ? uncachedEmails : [valid[0]], // need at least one to detect catch-all
      domain,
      mxHost
    );
    smtpBlocked = smtp.blocked;

    if (!smtpBlocked) {
      catchAll = smtp.catchAll;
      cacheSet(`catchall:${domain}`, catchAll, TTL.CATCH_ALL);

      for (const [email, result] of Object.entries(smtp.results)) {
        smtpResults[email] = result;
        cacheSet(`email:${email}`, result, TTL.EMAIL);
      }
    }
  }

  catchAll = catchAll ?? false;

  // Build results
  const results: EmailResult[] = valid
    .map((email) => {
      const raw = smtpResults[email] ?? "unknown";

      let status: EmailStatus;
      if (catchAll) {
        status = "catch_all_domain";
      } else if (smtpBlocked || raw === "unknown") {
        status = "unknown";
      } else if (raw === "accepted") {
        status = "verified";
      } else {
        status = "invalid";
      }

      const confidence: EmailResult["confidence"] =
        status === "verified" ? "high"
        : status === "invalid" ? "high"
        : status === "catch_all_domain" ? "low"
        : "medium";

      return { email, status, confidence };
    })
    // Sort: verified first, then by pattern prevalence rank
    .sort((a, b) => {
      if (a.status === "verified" && b.status !== "verified") return -1;
      if (b.status === "verified" && a.status !== "verified") return 1;
      if (a.status === "invalid" && b.status !== "invalid") return 1;
      if (b.status === "invalid" && a.status !== "invalid") return -1;
      return rankLabel(a.email, firstName, lastName) - rankLabel(b.email, firstName, lastName);
    });

  // Recommended = first verified, or first non-invalid ranked candidate
  const recommended =
    results.find((r) => r.status === "verified")?.email ??
    results.find((r) => r.status !== "invalid")?.email ??
    null;

  return {
    domain,
    is_catch_all: catchAll,
    mx_found: true,
    smtp_blocked: smtpBlocked,
    results,
    recommended_email: recommended,
  };
}
