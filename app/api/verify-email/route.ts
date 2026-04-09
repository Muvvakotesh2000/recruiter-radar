import { NextResponse } from "next/server";
import dns from "dns/promises";
import net from "net";

export type VerifyResult =
  | "valid"           // SMTP confirmed + not catch-all
  | "invalid"         // SMTP rejected (550/551)
  | "catch_all"       // domain accepts any address
  | "domain_ok"       // MX exists but SMTP check blocked/inconclusive
  | "no_mx"           // domain has no mail servers
  | "invalid_format";

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

// ─── Layer 2+3 via Hunter.io (works on Vercel — no port-25 restriction) ──────

async function hunterVerify(email: string, apiKey: string): Promise<VerifyResult> {
  try {
    const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return "domain_ok";

    const json = await res.json();
    const d = json?.data;
    if (!d) return "domain_ok";

    if (d.accept_all) return "catch_all";
    if (d.result === "deliverable") return "valid";
    if (d.result === "undeliverable") return "invalid";
    return "domain_ok"; // risky / unknown
  } catch {
    return "domain_ok";
  }
}

// ─── Layer 2+3 via raw SMTP (only works on non-blocked hosts) ─────────────────

function smtpProbe(email: string, mxHost: string): Promise<"valid" | "invalid" | "catch_all" | "domain_ok"> {
  return new Promise((resolve) => {
    const domain = email.split("@")[1];
    const randomEmail = `randchk${Math.random().toString(36).slice(2, 10)}@${domain}`;

    let resolved = false;
    let buffer = "";
    let stage = 0;
    let targetAccepted: boolean | null = null;

    const done = (r: "valid" | "invalid" | "catch_all" | "domain_ok") => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(r);
    };

    const timer = setTimeout(() => done("domain_ok"), 8000);
    const socket = net.createConnection({ port: 25, host: mxHost });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("ascii");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);

        const code = line.slice(0, 3);
        const isFinal = line.length < 4 || line[3] === " ";
        if (!isFinal) continue;

        switch (stage) {
          case 0:
            if (code === "220") { stage = 1; socket.write("EHLO verifier.local\r\n"); }
            else done("domain_ok");
            break;
          case 1:
            if (code === "250") { stage = 2; socket.write("MAIL FROM:<v@verifier.local>\r\n"); }
            else done("domain_ok");
            break;
          case 2:
            if (code === "250") { stage = 3; socket.write(`RCPT TO:<${email}>\r\n`); }
            else done("domain_ok");
            break;
          case 3:
            targetAccepted = code === "250";
            stage = 4;
            socket.write(`RCPT TO:<${randomEmail}>\r\n`);
            break;
          case 4: {
            const randomAccepted = code === "250";
            socket.write("QUIT\r\n");
            if (!targetAccepted) done("invalid");
            else if (randomAccepted) done("catch_all");
            else done("valid");
            break;
          }
        }
      }
    });

    socket.on("error", () => done("domain_ok"));
    socket.on("close", () => { if (!resolved) done("domain_ok"); });
  });
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email")?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ result: "invalid_format" satisfies VerifyResult });
  }

  const domain = email.split("@")[1];

  // Layer 1: MX
  const mxHost = await getMxHost(domain);
  if (!mxHost) {
    return NextResponse.json({ result: "no_mx" satisfies VerifyResult });
  }

  // Layer 2+3: prefer Hunter.io (works on Vercel), fall back to raw SMTP
  const hunterKey = process.env.HUNTER_API_KEY;
  const result: VerifyResult = hunterKey
    ? await hunterVerify(email, hunterKey)
    : await smtpProbe(email, mxHost);

  return NextResponse.json({ result });
}
