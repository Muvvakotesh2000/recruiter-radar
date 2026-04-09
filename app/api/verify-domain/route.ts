import { NextResponse } from "next/server";
import dns from "dns/promises";
import net from "net";

// ─── Types ────────────────────────────────────────────────────────────────────

type EmailResult = "accepted" | "rejected" | "unknown";

export interface VerifyDomainResponse {
  mx: boolean;
  smtp_blocked: boolean;   // true when port 25 is unreachable (e.g. Vercel)
  catch_all: boolean;      // domain accepts any recipient
  results: Record<string, EmailResult>;
}

// ─── Layer 1: DNS MX ─────────────────────────────────────────────────────────

async function getMxHost(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveMx(domain);
    if (!records?.length) return null;
    records.sort((a, b) => a.priority - b.priority);
    return records[0].exchange;
  } catch {
    return null;
  }
}

// ─── Layer 2: SMTP bulk check (single connection for all emails) ──────────────
// Opens one SMTP session and sends RCPT TO for every email + a random probe.
// Returns per-email results + catch-all flag.
// Falls back gracefully when port 25 is blocked.

function smtpBulkCheck(
  emails: string[],
  domain: string,
  mxHost: string
): Promise<{ blocked: boolean; catchAll: boolean; results: Record<string, EmailResult> }> {
  return new Promise((resolve) => {
    const randomEmail = `randchk${Math.random().toString(36).slice(2, 10)}@${domain}`;
    const queue = [...emails, randomEmail]; // test real emails then catch-all probe

    const results: Record<string, EmailResult> = {};
    emails.forEach((e) => (results[e] = "unknown"));

    let resolved = false;
    let buffer = "";

    // SMTP state machine stages:
    // 0 = wait banner  1 = wait EHLO  2 = wait MAIL FROM
    // 3..N = wait RCPT TO for each queued email
    let stage = 0;
    let queueIdx = 0;

    const done = (blocked: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* ignore */ }

      const randomResult = results[randomEmail] ?? "unknown";
      // Catch-all: random fake address was accepted
      const catchAll = randomResult === "accepted";

      // Remove the random probe from public results
      delete results[randomEmail];

      resolve({ blocked, catchAll, results });
    };

    const timer = setTimeout(() => done(true), 10000);

    const socket = net.createConnection({ port: 25, host: mxHost });

    const sendNextRcpt = () => {
      if (queueIdx < queue.length) {
        socket.write(`RCPT TO:<${queue[queueIdx]}>\r\n`);
      } else {
        socket.write("QUIT\r\n");
        done(false);
      }
    };

    socket.on("data", (chunk) => {
      buffer += chunk.toString("ascii");

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);

        const code = line.slice(0, 3);
        // Only act on final line of multi-line responses (space after code, not dash)
        const isFinal = line.length < 4 || line[3] === " ";
        if (!isFinal) continue;

        switch (stage) {
          case 0: // server banner
            if (code === "220") {
              stage = 1;
              socket.write("EHLO verifier.local\r\n");
            } else {
              done(false);
            }
            break;

          case 1: // EHLO response
            if (code === "250") {
              stage = 2;
              socket.write("MAIL FROM:<v@verifier.local>\r\n");
            } else {
              done(false);
            }
            break;

          case 2: // MAIL FROM response
            if (code === "250") {
              stage = 3;
              sendNextRcpt();
            } else {
              done(false);
            }
            break;

          default: { // RCPT TO responses
            const email = queue[queueIdx];
            if (code === "250") {
              results[email] = "accepted";
            } else if (code[0] === "5") {
              results[email] = "rejected";
            }
            // 4xx = temporary failure → leave as "unknown"
            queueIdx++;
            sendNextRcpt();
            break;
          }
        }
      }
    });

    socket.on("error", () => done(true));  // port blocked or refused
    socket.on("close", () => { if (!resolved) done(false); });
  });
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let body: { domain?: string; emails?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { domain, emails } = body;

  if (!domain || !Array.isArray(emails) || emails.length === 0) {
    return NextResponse.json({ error: "domain and emails[] required" }, { status: 400 });
  }

  // Basic syntax filter — remove obviously malformed entries
  const validEmails = emails.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  // Layer 1: MX
  const mxHost = await getMxHost(domain);
  if (!mxHost) {
    const noMxResults: Record<string, EmailResult> = {};
    validEmails.forEach((e) => (noMxResults[e] = "rejected"));
    return NextResponse.json({
      mx: false,
      smtp_blocked: false,
      catch_all: false,
      results: noMxResults,
    } satisfies VerifyDomainResponse);
  }

  // Layer 2+3+4: single SMTP session
  const { blocked, catchAll, results } = await smtpBulkCheck(validEmails, domain, mxHost);

  return NextResponse.json({
    mx: true,
    smtp_blocked: blocked,
    catch_all: catchAll,
    results,
  } satisfies VerifyDomainResponse);
}
