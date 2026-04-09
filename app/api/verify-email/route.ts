import { NextResponse } from "next/server";
import dns from "dns/promises";
import net from "net";

// ─── Types ────────────────────────────────────────────────────────────────────

type SmtpOutcome =
  | "accepted"    // RCPT TO returned 250
  | "rejected"    // RCPT TO returned 5xx
  | "catch_all"   // accepted target AND random address → server accepts everything
  | "smtp_blocked"// port 25 connection refused / timed out (common on cloud hosts)
  | "unknown";    // connected but got unexpected response

export type VerifyResult =
  | "valid"        // SMTP confirmed + not catch-all
  | "invalid"      // SMTP rejected (550/551/553)
  | "catch_all"    // domain accepts any address — rank, don't trust
  | "domain_ok"    // MX exists but SMTP blocked; could still be real
  | "no_mx"        // domain has no mail servers → definitely bad
  | "invalid_format";

// ─── Layer 1: MX check ────────────────────────────────────────────────────────

async function getMxHost(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveMx(domain);
    if (!records || records.length === 0) return null;
    // Pick the host with the lowest priority value (highest priority)
    records.sort((a, b) => a.priority - b.priority);
    return records[0].exchange;
  } catch {
    return null;
  }
}

// ─── Layer 2 + 3: SMTP probe + catch-all detection ───────────────────────────

function smtpProbe(email: string, mxHost: string): Promise<SmtpOutcome> {
  return new Promise((resolve) => {
    const domain = email.split("@")[1];
    const randomEmail = `randchk${Math.random().toString(36).slice(2, 10)}@${domain}`;

    let resolved = false;
    let buffer = "";
    let stage = 0;
    let targetAccepted: boolean | null = null;

    const done = (outcome: SmtpOutcome) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(outcome);
    };

    // Overall timeout — 8 s is generous for a single SMTP conversation
    const timer = setTimeout(() => done("smtp_blocked"), 8000);

    const socket = net.createConnection({ port: 25, host: mxHost });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("ascii");

      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);

        const code = line.slice(0, 3);
        // Multi-line SMTP responses end with "CODE " (space); continuation lines use "CODE-"
        const isFinal = line.length >= 4 ? line[3] === " " : true;
        if (!isFinal) continue;

        switch (stage) {
          case 0: // server banner
            if (code === "220") {
              stage = 1;
              socket.write("EHLO verifier.local\r\n");
            } else {
              done("unknown");
            }
            break;

          case 1: // EHLO response
            if (code === "250") {
              stage = 2;
              socket.write("MAIL FROM:<v@verifier.local>\r\n");
            } else {
              done("unknown");
            }
            break;

          case 2: // MAIL FROM response
            if (code === "250") {
              stage = 3;
              socket.write(`RCPT TO:<${email}>\r\n`);
            } else {
              done("unknown");
            }
            break;

          case 3: // RCPT TO (target email) response
            targetAccepted = code === "250";
            stage = 4;
            // Layer 3: probe with a random address to detect catch-all
            socket.write(`RCPT TO:<${randomEmail}>\r\n`);
            break;

          case 4: { // RCPT TO (random address) response — catch-all check
            const randomAccepted = code === "250";
            socket.write("QUIT\r\n");

            if (!targetAccepted) {
              done("rejected");
            } else if (randomAccepted) {
              // Both real and random accepted → catch-all domain
              done("catch_all");
            } else {
              done("accepted");
            }
            break;
          }
        }
      }
    });

    socket.on("error", () => done("smtp_blocked"));
    socket.on("close", () => { if (!resolved) done("unknown"); });
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email")?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  // Layer 0: format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ result: "invalid_format" satisfies VerifyResult });
  }

  const domain = email.split("@")[1];

  // Layer 1: MX check
  const mxHost = await getMxHost(domain);
  if (!mxHost) {
    return NextResponse.json({ result: "no_mx" satisfies VerifyResult });
  }

  // Layer 2 + 3: SMTP probe
  const smtp = await smtpProbe(email, mxHost);

  let result: VerifyResult;
  switch (smtp) {
    case "accepted":     result = "valid";      break;
    case "rejected":     result = "invalid";    break;
    case "catch_all":    result = "catch_all";  break;
    default:             result = "domain_ok";  break; // smtp_blocked / unknown → best-effort
  }

  return NextResponse.json({ result, smtp_detail: smtp });
}
