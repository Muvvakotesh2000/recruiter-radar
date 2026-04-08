import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createJob } from "@/lib/services/jobs";
import { runGeneration } from "@/lib/services/generation";
import { JobSubmitSchema } from "@/lib/validations/job";
import { ZodError } from "zod";

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

    const body = await request.json();
    const input = JobSubmitSchema.parse(body);

    const job = await createJob({
      userId: user.id,
      company_name: input.company_name,
      job_title: input.job_title,
      job_url: input.job_url,
      location: input.location,
    });

    const result = await runGeneration({
      userId: user.id,
      jobId: job.id,
      input: {
        company_name: input.company_name,
        job_title: input.job_title,
        job_url: input.job_url ?? "",
        location: input.location ?? "",
      },
    });

    return NextResponse.json(
      {
        data: {
          job_id: job.id,
          recruiter_count: result.recruiterCount,
        },
        success: true,
        error: null,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error:
            "Validation failed: " +
            error.errors.map((e) => e.message).join(", "),
          success: false,
        },
        { status: 400 }
      );
    }

    console.error("[API /generate] Error:", error);
    const message =
      error instanceof Error
        ? error.message
        : "An unexpected error occurred.";

    return NextResponse.json(
      { error: message, success: false },
      { status: 500 }
    );
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
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId is required", success: false },
        { status: 400 }
      );
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

    const result = await runGeneration({
      userId: user.id,
      jobId: job.id,
      input: {
        company_name: job.company_name,
        job_title: job.job_title,
        job_url: job.job_url ?? "",
        location: job.location ?? "",
      },
    });

    return NextResponse.json(
      {
        data: { recruiter_count: result.recruiterCount },
        success: true,
        error: null,
      },
      { status: 200 }
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