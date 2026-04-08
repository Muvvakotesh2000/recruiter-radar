export * from "./ai";
export * from "./database";

// ─── API Types ─────────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  success: boolean;
}

export interface GenerateRequest {
  company_name: string;
  job_title: string;
  job_url: string;
  location: string;
  ai_provider?: string;
}

export interface GenerateResponse {
  job_id: string;
  recruiter_count: number;
}

// ─── UI Types ──────────────────────────────────────────────────────────────────

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: "default" | "destructive" | "success";
}

export type LoadingState = "idle" | "loading" | "success" | "error";
