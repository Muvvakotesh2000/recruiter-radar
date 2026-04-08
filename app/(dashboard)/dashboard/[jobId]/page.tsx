import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getJobWithLeads, getLastGenerationRun } from "@/lib/services/jobs";
import { JobDetailContent } from "@/components/dashboard/job-detail-content";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<Metadata> {
  const { jobId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { title: "Job Details" };

  const job = await getJobWithLeads(jobId, user.id);
  if (!job) return { title: "Not Found" };

  return {
    title: `${job.job_title} at ${job.company_name}`,
  };
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [job, lastRun] = await Promise.all([
    getJobWithLeads(jobId, user.id),
    getLastGenerationRun(jobId, user.id),
  ]);

  if (!job) notFound();

  return <JobDetailContent job={job} lastRun={lastRun} />;
}
