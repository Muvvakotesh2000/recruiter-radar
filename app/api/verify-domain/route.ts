import { NextResponse } from "next/server";

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
  cached?: boolean;
}

const WORKER_URL = process.env.VALIDATION_WORKER_URL;
const WORKER_SECRET = process.env.VALIDATION_SECRET;

function workerHeaders() {
  return {
    "Content-Type": "application/json",
    ...(WORKER_SECRET ? { "x-validation-secret": WORKER_SECRET } : {}),
  };
}

// Poll /result/:jobId until complete or timeout
async function pollResult(jobId: string, maxWaitMs = 30000): Promise<BatchResult | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(`${WORKER_URL}/result/${jobId}`, {
        headers: workerHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      if (data.status === "completed") return data.result as BatchResult;
      if (data.status === "failed") return null;
      // still pending/active — keep polling
    } catch { /* network blip — keep polling */ }
  }
  return null;
}

export async function POST(request: Request) {
  if (!WORKER_URL) {
    return NextResponse.json(
      { error: "Validation worker not configured. Set VALIDATION_WORKER_URL." },
      { status: 503 }
    );
  }

  let body: { domain?: string; emails?: string[]; first_name?: string; last_name?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { domain, emails, first_name, last_name } = body;
  if (!domain || !Array.isArray(emails) || !emails.length || !first_name || !last_name) {
    return NextResponse.json(
      { error: "domain, emails[], first_name, last_name required" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(`${WORKER_URL}/validate-batch`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify({ domain, emails, first_name, last_name }),
      signal: AbortSignal.timeout(25000),
    });

    if (res.status === 202) {
      // Worker is busy — job was queued, poll for result
      const { jobId } = await res.json();
      const result = await pollResult(jobId);
      if (!result) {
        return NextResponse.json({ error: "Validation timed out" }, { status: 504 });
      }
      return NextResponse.json(result);
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: (err as { error?: string }).error ?? "Worker error" },
        { status: res.status }
      );
    }

    return NextResponse.json(await res.json());
  } catch (err) {
    console.error("[verify-domain] worker error:", err);
    return NextResponse.json({ error: "Validation worker unreachable" }, { status: 502 });
  }
}
