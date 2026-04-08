/**
 * Recruiter lead service helpers.
 */

import { createClient } from "@/lib/supabase/server";
import type { RecruiterLead } from "@/types/database";

export async function getRecruiterLeadsForJob(
  jobId: string,
  userId: string
): Promise<RecruiterLead[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("recruiter_leads")
    .select("*")
    .eq("job_id", jobId)
    .eq("user_id", userId)
    .order("confidence_level", { ascending: false });

  if (error) throw new Error(`Failed to fetch recruiter leads: ${error.message}`);
  return data ?? [];
}

export async function deleteRecruiterLead(
  leadId: string,
  userId: string
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("recruiter_leads")
    .delete()
    .eq("id", leadId)
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to delete lead: ${error.message}`);
}
