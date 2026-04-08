export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          updated_at?: string;
        };
      };
      jobs: {
        Row: {
          id: string;
          user_id: string;
          company_name: string;
          job_title: string;
          job_url: string;
          location: string;
          status: "pending" | "processing" | "completed" | "failed";
          ai_provider: string;
          email_pattern: string | null;
          hiring_team_notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          company_name: string;
          job_title: string;
          job_url: string;
          location: string;
          status?: "pending" | "processing" | "completed" | "failed";
          ai_provider?: string;
          email_pattern?: string | null;
          hiring_team_notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          company_name?: string;
          job_title?: string;
          job_url?: string;
          location?: string;
          status?: "pending" | "processing" | "completed" | "failed";
          ai_provider?: string;
          email_pattern?: string | null;
          hiring_team_notes?: string | null;
          updated_at?: string;
        };
      };
      recruiter_leads: {
        Row: {
          id: string;
          job_id: string;
          user_id: string;
          full_name: string;
          recruiter_title: string;
          linkedin_url: string | null;
          email: string | null;
          email_type: "verified" | "estimated" | "unknown";
          confidence_level: "High" | "Medium" | "Low";
          source: string;
          outreach_message: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          job_id: string;
          user_id: string;
          full_name: string;
          recruiter_title: string;
          linkedin_url?: string | null;
          email?: string | null;
          email_type?: "verified" | "estimated" | "unknown";
          confidence_level?: "High" | "Medium" | "Low";
          source?: string;
          outreach_message?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string;
          recruiter_title?: string;
          linkedin_url?: string | null;
          email?: string | null;
          email_type?: "verified" | "estimated" | "unknown";
          confidence_level?: "High" | "Medium" | "Low";
          source?: string;
          outreach_message?: string;
          updated_at?: string;
        };
      };
      generation_runs: {
        Row: {
          id: string;
          user_id: string;
          job_id: string;
          ai_provider: string;
          model_name: string;
          search_provider: string | null;
          search_queries_used: string[] | null;
          prompt_text: string | null;
          raw_response: string | null;
          status: "running" | "completed" | "failed";
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          job_id: string;
          ai_provider: string;
          model_name: string;
          search_provider?: string | null;
          search_queries_used?: string[] | null;
          prompt_text?: string | null;
          raw_response?: string | null;
          status?: "running" | "completed" | "failed";
          error_message?: string | null;
          created_at?: string;
        };
        Update: {
          raw_response?: string | null;
          status?: "running" | "completed" | "failed";
          error_message?: string | null;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

// ─── Convenience types ──────────────────────────────────────────────────────

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Job = Database["public"]["Tables"]["jobs"]["Row"];
export type RecruiterLead = Database["public"]["Tables"]["recruiter_leads"]["Row"];
export type GenerationRun = Database["public"]["Tables"]["generation_runs"]["Row"];

export type JobWithLeads = Job & {
  recruiter_leads: RecruiterLead[];
};
