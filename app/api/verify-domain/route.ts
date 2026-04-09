import { NextResponse } from "next/server";

// Re-export worker response shape so recruiter-card can import the type
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

export async function POST(request: Request) {
  const workerUrl = process.env.VALIDATION_WORKER_URL;
  const workerSecret = process.env.VALIDATION_SECRET;

  if (!workerUrl) {
    return NextResponse.json(
      { error: "Validation worker not configured. Set VALIDATION_WORKER_URL in environment." },
      { status: 503 }
    );
  }

  let body: { domain?: string; emails?: string[]; first_name?: string; last_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { domain, emails, first_name, last_name } = body;
  if (!domain || !Array.isArray(emails) || emails.length === 0) {
    return NextResponse.json({ error: "domain, emails[], first_name, last_name required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${workerUrl}/validate-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerSecret ? { "x-validation-secret": workerSecret } : {}),
      },
      body: JSON.stringify({ domain, emails, first_name, last_name }),
      // 15s timeout — SMTP can be slow
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: (err as { error?: string }).error ?? "Worker error" },
        { status: res.status }
      );
    }

    const data: BatchResult = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[verify-domain] worker unreachable:", err);
    return NextResponse.json(
      { error: "Validation worker unreachable" },
      { status: 502 }
    );
  }
}
