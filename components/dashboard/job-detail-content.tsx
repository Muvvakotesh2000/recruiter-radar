"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  MapPin,
  ExternalLink,
  RefreshCw,
  Trash2,
  Users,
  Mail,
  Clock,
  Info,
  Copy,
  Check,
  Search,
  ChevronDown,
  ChevronUp,
  Pencil,
  Loader2,
} from "lucide-react";
import type { JobWithLeads } from "@/types/database";
import { RecruiterCard } from "./recruiter-card";
import { RecruiterCardSkeleton } from "./skeleton-loaders";
import { EditJobModal } from "./edit-job-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  formatDateTime,
  getStatusColor,
  copyToClipboard,
} from "@/lib/utils";
import { extractCompanyDomain } from "@/lib/services/hunter";
import { buildLocationTiers, locationTierScore } from "@/lib/services/recruiter-extractor";

interface LastRunInfo {
  id: string;
  ai_provider: string;
  search_provider: string | null;
  search_queries_used: string[] | null;
  status: string;
  created_at: string;
}

interface JobDetailContentProps {
  job: JobWithLeads;
  lastRun?: LastRunInfo | null;
}

export function JobDetailContent({ job, lastRun }: JobDetailContentProps) {
  const router = useRouter();
  const [regenerating, setRegenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedEmails, setCopiedEmails] = useState(false);
  const [showQueries, setShowQueries] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // Live status updates: poll Supabase DB directly every 4s + Realtime for instant updates
  useEffect(() => {
    if (job.status !== "pending" && job.status !== "processing") return;

    const supabase = createClient();
    let done = false;

    function onComplete() {
      if (done) return;
      done = true;
      router.refresh();
    }

    // Polling fallback: query the DB directly — only calls router.refresh() once when done
    const pollInterval = setInterval(async () => {
      const { data } = await supabase
        .from("jobs")
        .select("status")
        .eq("id", job.id)
        .single();
      const polledStatus = (data as { status: string } | null)?.status;
      if (polledStatus === "completed" || polledStatus === "failed") {
        clearInterval(pollInterval);
        onComplete();
      }
    }, 4000);

    // Realtime for instant delivery (fires before next poll cycle)
    const channel = supabase
      .channel(`job-status-${job.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "jobs",
          filter: `id=eq.${job.id}`,
        },
        (payload) => {
          const newStatus = (payload.new as { status: string }).status;
          if (newStatus === "completed" || newStatus === "failed") {
            clearInterval(pollInterval);
            onComplete();
          }
        }
      )
      .subscribe();

    return () => {
      done = true;
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [job.id, job.status, router]);

  const status = getStatusColor(job.status);
  const CONFIDENCE_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

  const locationTiers = buildLocationTiers(job.location ?? "");
  function locationRank(leadLocation: string | null): number {
    if (!leadLocation) return 4;
    return locationTierScore(leadLocation, locationTiers);
  }

  const leads = (job.recruiter_leads ?? []).slice().sort((a, b) => {
    const aLocationRank = locationRank(a.location);
    const bLocationRank = locationRank(b.location);
    if (aLocationRank !== bLocationRank) return aLocationRank - bLocationRank;
    return (CONFIDENCE_ORDER[a.confidence_level] ?? 3) - (CONFIDENCE_ORDER[b.confidence_level] ?? 3);
  });
  const emailLeads = leads.filter((l) => l.email);
  const companyDomain = extractCompanyDomain(job.job_url, job.company_name);

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await fetch("/api/generate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      toast.success("Regenerating leads...", {
        description: "Searching in the background. Results will appear automatically.",
      });
      router.refresh(); // refresh to show "processing" status
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Regeneration failed";
      toast.error("Failed to regenerate", { description: msg });
    } finally {
      setRegenerating(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this job and all recruiter leads? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/generate?jobId=${job.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      toast.success("Job deleted");
      router.push("/dashboard");
    } catch {
      toast.error("Failed to delete");
      setDeleting(false);
    }
  }

  async function handleCopyAllEmails() {
    const emails = emailLeads.map((l) => l.email).join(", ");
    const ok = await copyToClipboard(emails);
    if (ok) {
      setCopiedEmails(true);
      toast.success(`${emailLeads.length} emails copied!`);
      setTimeout(() => setCopiedEmails(false), 2000);
    }
  }

  return (
    <div className="min-h-screen mesh-bg">
      <EditJobModal
        open={editOpen}
        onOpenChange={setEditOpen}
        job={job}
        onSuccess={() => router.refresh()}
      />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back button */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>

        {/* Job header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-6 border border-border/50 mb-8"
        >
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            {/* Company icon */}
            <div className="w-14 h-14 rounded-xl bg-brand-400/15 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-7 h-7 text-brand-400" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-start gap-2 mb-2">
                <h1 className="font-display text-2xl font-bold text-foreground">
                  {job.job_title}
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.bg} ${status.text} border border-current/20`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${status.dot} ${job.status === 'processing' ? 'animate-pulse' : ''}`} />
                  {job.status}
                </span>
              </div>

              <p className="text-lg text-muted-foreground mb-3">{job.company_name}</p>

              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4" />
                  {job.location}
                </span>
                <a
                  href={job.job_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 hover:text-foreground transition-colors hover:underline"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Job Posting
                </a>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  {formatDateTime(job.created_at)}
                </span>
              </div>

              {/* Metadata */}
              {(job.email_pattern || job.hiring_team_notes) && (
                <div className="mt-4 space-y-2">
                  {job.email_pattern && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="w-4 h-4 text-brand-400 flex-shrink-0" />
                      <span className="text-muted-foreground">Email pattern:</span>
                      <code className="text-brand-300 font-mono text-xs bg-brand-500/10 px-2 py-0.5 rounded">
                        {job.email_pattern}
                      </code>
                    </div>
                  )}
                  {job.hiring_team_notes && (
                    <div className="flex items-start gap-2 text-sm">
                      <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        {job.hiring_team_notes}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex sm:flex-col gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditOpen(true)}
                className="gap-2"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerate}
                loading={regenerating}
                className="gap-2"
              >
                {!regenerating && <RefreshCw className="w-3.5 h-3.5" />}
                Regenerate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                loading={deleting}
                className="gap-2 border-red-500/20 text-red-400 hover:bg-red-500/10 hover:border-red-500/40"
              >
                {!deleting && <Trash2 className="w-3.5 h-3.5" />}
                Delete
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Search queries panel */}
        {lastRun?.search_queries_used && lastRun.search_queries_used.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass rounded-xl border border-border/50 overflow-hidden mb-8"
          >
            <button
              onClick={() => setShowQueries(!showQueries)}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-secondary/20 transition-colors"
            >
              <div className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
                <Search className="w-4 h-4 text-brand-400" />
                <span>
                  Search queries executed
                </span>
                <span className="px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-400 text-xs border border-brand-500/20">
                  {lastRun.search_queries_used.length} queries
                  {lastRun.search_provider && ` · ${lastRun.search_provider}`}
                </span>
              </div>
              {showQueries ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>

            {showQueries && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="border-t border-border/50 px-5 py-4 space-y-2"
              >
                <p className="text-xs text-muted-foreground mb-3">
                  These queries were generated by AI and executed against real web search to find grounded recruiter contacts.
                </p>
                {lastRun.search_queries_used.map((q, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="text-xs font-mono text-muted-foreground/50 mt-0.5 flex-shrink-0 w-5">
                      {i + 1}.
                    </span>
                    <code className="text-xs text-brand-300 bg-brand-500/8 border border-brand-500/15 rounded-md px-2.5 py-1.5 font-mono break-all">
                      {q}
                    </code>
                  </div>
                ))}
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Recruiter leads section */}
        <div>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-xl font-bold text-foreground">
                Recruiter Leads
              </h2>
              {(job.status === "pending" || job.status === "processing") ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-brand-500/10 text-brand-400 border border-brand-500/20">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Searching...
                </span>
              ) : (
                <Badge variant="purple" className="text-xs">
                  {leads.length} found
                </Badge>
              )}
            </div>

            {emailLeads.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyAllEmails}
                className="gap-2 text-muted-foreground hover:text-foreground"
              >
                {copiedEmails ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                Copy all {emailLeads.length} emails
              </Button>
            )}
          </div>

          {(job.status === "pending" || job.status === "processing") ? (
            <GeneratingLeadsState />
          ) : leads.length === 0 ? (
            <div className="text-center py-16 glass rounded-xl border border-border/50">
              <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground font-medium">No recruiter leads found</p>
              <p className="text-sm text-muted-foreground/70 mt-1 mb-4">
                {job.status === "failed"
                  ? "Generation failed. Try regenerating."
                  : "Try regenerating to find recruiter contacts."}
              </p>
              <Button
                variant="gradient"
                size="sm"
                onClick={handleRegenerate}
                loading={regenerating}
                className="gap-2"
              >
                {!regenerating && <RefreshCw className="w-4 h-4" />}
                Try Again
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {leads.map((lead, index) => (
                <RecruiterCard key={lead.id} lead={lead} index={index} companyDomain={companyDomain} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const SEARCH_STEPS = [
  "Generating targeted search queries...",
  "Searching LinkedIn for recruiter profiles...",
  "Querying Apollo & RocketReach for contacts...",
  "Detecting company email pattern...",
  "Extracting recruiter contacts from results...",
  "Building personalized outreach messages...",
];

function GeneratingLeadsState() {
  const [stepIndex, setStepIndex] = useState(0);
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    const stepInterval = setInterval(() => {
      setStepIndex((i) => (i + 1) % SEARCH_STEPS.length);
    }, 4000);

    const progressInterval = setInterval(() => {
      setProgress((p) => {
        if (p >= 92) return p;
        return p + Math.random() * 4;
      });
    }, 1200);

    return () => {
      clearInterval(stepInterval);
      clearInterval(progressInterval);
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* Progress card */}
      <div className="glass rounded-xl border border-brand-500/20 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-brand-500/10 flex items-center justify-center flex-shrink-0">
            <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Finding recruiter leads...</p>
            <p className="text-xs text-muted-foreground">This usually takes 15–30 seconds</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden mb-3">
          <motion.div
            className="h-full bg-brand-400 rounded-full"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </div>

        {/* Current step */}
        <AnimatePresence mode="wait">
          <motion.p
            key={stepIndex}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.3 }}
            className="text-xs text-muted-foreground"
          >
            {SEARCH_STEPS[stepIndex]}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Skeleton cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <RecruiterCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
