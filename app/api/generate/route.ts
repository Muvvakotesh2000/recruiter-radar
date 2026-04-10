import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@/lib/supabase/server";
import { createJob } from "@/lib/services/jobs";
import { runGeneration } from "@/lib/services/generation";
import { JobSubmitSchema } from "@/lib/validations/job";
import { ZodError } from "zod";

// Allow up to 5 minutes on Vercel Pro (background generation)
export const maxDuration = 300;

// Rate limit: max jobs per user per hour
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

type JobRow = {
  id: string;
  company_name: string;
  job_title: string;
  job_url: string | null;
  location: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to continue.", success: false },
        { status: 401 }
      );
    }

    // ── Rate limiting: max 10 jobs per user per hour ──────────────────────────
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count: recentJobCount } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", windowStart);

    if ((recentJobCount ?? 0) >= RATE_LIMIT_MAX) {
      return NextResponse.json(
        { error: `Rate limit reached. You can submit up to ${RATE_LIMIT_MAX} jobs per hour.`, success: false },
        { status: 429 }
      );
    }

    // ── Concurrency control: max 1 processing job per user ────────────────────
    const { count: activeJobCount } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "processing");

    if ((activeJobCount ?? 0) >= 1) {
      return NextResponse.json(
        { error: "A search is already in progress. Please wait for it to finish.", success: false },
        { status: 409 }
      );
    }

    const body = await request.json();
    const input = JobSubmitSchema.parse(body);

    // ── Create job record immediately ─────────────────────────────────────────
    const job = await createJob({
      userId: user.id,
      company_name: input.company_name,
      job_title: input.job_title,
      job_url: input.job_url,
      location: input.location,
    });

    // ── Run generation in background — don't block the response ──────────────
    waitUntil(
      runGeneration({
        userId: user.id,
        jobId: job.id,
        input: {
          company_name: input.company_name,
          job_title: input.job_title,
          job_url: input.job_url ?? "",
          location: input.location ?? "",
          recruiter_hint: input.recruiter_hint,
        },
      }).catch((err) => {
        console.error(`[API /generate] Background generation failed for job ${job.id}:`, err);
      })
    );

    // Return job_id immediately — frontend navigates and listens via Realtime
    return NextResponse.json(
      { data: { job_id: job.id }, success: true, error: null },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed: " + error.errors.map((e) => e.message).join(", "),
          success: false,
        },
        { status: 400 }
      );
    }

    console.error("[API /generate] Error:", error);
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    return NextResponse.json({ error: message, success: false }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", success: false },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId is required", success: false },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("jobs")
      .delete()
      .eq("id", jobId)
      .eq("user_id", user.id);

    if (error) throw new Error(error.message);

    return NextResponse.json(
      { success: true, error: null },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete job";

    return NextResponse.json(
      { error: message, success: false },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", success: false },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { jobId, company_name, job_title, job_url, location } = body;

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId is required", success: false },
        { status: 400 }
      );
    }

    // If updated fields are provided, apply them first
    const hasUpdates = company_name || job_title || job_url || location;
    if (hasUpdates) {
      const updates: Partial<JobRow> = {};
      if (company_name) updates.company_name = company_name;
      if (job_title) updates.job_title = job_title;
      if (job_url) updates.job_url = job_url;
      if (location) updates.location = location;

      const { error: updateError } = await supabase
        .from("jobs")
        .update(updates as never)
        .eq("id", jobId)
        .eq("user_id", user.id);

      if (updateError) {
        return NextResponse.json(
          { error: "Failed to update job", success: false },
          { status: 500 }
        );
      }
    }

    const { data, error: jobError } = await supabase
      .from("jobs")
      .select("id, company_name, job_title, job_url, location")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (jobError || !data) {
      return NextResponse.json(
        { error: "Job not found", success: false },
        { status: 404 }
      );
    }

    const job = data as JobRow;

    // Run regeneration in background
    waitUntil(
      runGeneration({
        userId: user.id,
        jobId: job.id,
        input: {
          company_name: job.company_name,
          job_title: job.job_title,
          job_url: job.job_url ?? "",
          location: job.location ?? "",
        },
      }).catch((err) => {
        console.error(`[API /generate PATCH] Background regeneration failed for job ${job.id}:`, err);
      })
    );

    return NextResponse.json(
      { data: { job_id: job.id }, success: true, error: null },
      { status: 202 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Regeneration failed";

    return NextResponse.json(
      { error: message, success: false },
      { status: 500 }
    );
  }
}