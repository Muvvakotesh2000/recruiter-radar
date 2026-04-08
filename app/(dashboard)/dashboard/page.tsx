import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getUserJobs, getDashboardMetrics } from "@/lib/services/jobs";
import { DashboardContent } from "@/components/dashboard/dashboard-content";

export const metadata: Metadata = {
  title: "Dashboard",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [jobs, metrics] = await Promise.all([
    getUserJobs(user.id),
    getDashboardMetrics(user.id),
  ]);

  return <DashboardContent initialJobs={jobs} metrics={metrics} userId={user.id} />;
}
