/**
 * Job CRUD operations.
 * All functions use the server-side Supabase client and are server-only.
 */

import { createClient } from "@/lib/supabase/server";
import type { Job, JobWithLeads } from "@/types/database";

export async function getUserJobs(userId: string): Promise<Job[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch jobs: ${error.message}`);
  return data ?? [];
}

export async function getJobWithLeads(
  jobId: string,
  userId: string
): Promise<JobWithLeads | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select("*, recruiter_leads(*)")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null; // not found
    throw new Error(`Failed to fetch job: ${error.message}`);
  }

  return data as JobWithLeads;
}

export async function createJob(params: {
  userId: string;
  company_name: string;
  job_title: string;
  job_url: string;
  location: string;
}): Promise<Job> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      user_id: params.userId,
      company_name: params.company_name,
      job_title: params.job_title,
      job_url: params.job_url,
      location: params.location,
      status: "pending",
      ai_provider: "openai",
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create job: ${error?.message}`);
  }

  return data;
}

export async function deleteJob(
  jobId: string,
  userId: string
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("jobs")
    .delete()
    .eq("id", jobId)
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to delete job: ${error.message}`);
}

/**
 * Returns the most recent generation run for a job, including
 * the search queries that were executed during that run.
 */
export async function getLastGenerationRun(jobId: string, userId: string) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("generation_runs")
    .select("id, ai_provider, search_provider, search_queries_used, status, created_at")
    .eq("job_id", jobId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return data ?? null;
}

export async function getDashboardMetrics(userId: string) {
  const supabase = await createClient();

  const [jobsResult, leadsResult] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status")
      .eq("user_id", userId),
    supabase
      .from("recruiter_leads")
      .select("id, confidence_level, email")
      .eq("user_id", userId),
  ]);

  const jobs = jobsResult.data ?? [];
  const leads = leadsResult.data ?? [];

  return {
    totalJobs: jobs.length,
    completedJobs: jobs.filter((j) => j.status === "completed").length,
    totalLeads: leads.length,
    highConfidenceLeads: leads.filter((l) => l.confidence_level === "High").length,
    leadsWithEmail: leads.filter((l) => l.email !== null).length,
  };
}
