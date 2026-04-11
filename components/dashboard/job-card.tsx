"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Building2,
  MapPin,
  Users,
  ExternalLink,
  Trash2,
  RefreshCw,
  Clock,
  ChevronRight,
  Pencil,
} from "lucide-react";
import type { Job } from "@/types/database";
import { Button } from "@/components/ui/button";
import { formatDateRelative, extractDomain, getStatusColor } from "@/lib/utils";

interface JobCardProps {
  job: Job;
  leadCount?: number;
  onDelete: (jobId: string) => void;
  onRegenerate: (jobId: string) => void;
  onEdit: (job: Job) => void;
  index: number;
}

export function JobCard({
  job,
  leadCount = 0,
  onDelete,
  onRegenerate,
  onEdit,
  index,
}: JobCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const status = getStatusColor(job.status);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${job.job_title}" at ${job.company_name}? This cannot be undone.`)) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/generate?jobId=${job.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      toast.success("Job deleted");
      onDelete(job.id);
    } catch {
      toast.error("Failed to delete job");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRegenerate(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setRegenerating(true);
    try {
      const res = await fetch("/api/generate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      toast.success("Leads regenerated!", {
        description: `Found ${data.data.recruiter_count} recruiter${data.data.recruiter_count !== 1 ? "s" : ""}`,
      });
      onRegenerate(job.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Regeneration failed";
      toast.error("Regeneration failed", { description: msg });
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35, ease: "easeOut" }}
    >
      <Link href={`/dashboard/${job.id}`} className="block group">
        <div className="glass rounded-xl p-5 border border-border/50 hover:border-brand-500/30 hover:shadow-glow transition-all duration-300 cursor-pointer relative overflow-hidden">
          {/* Gradient accent line */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-brand-500/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

          <div className="flex items-start gap-4">
            {/* Company icon */}
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-500/20 to-blue-500/20 border border-brand-500/20 flex items-center justify-center flex-shrink-0 group-hover:from-brand-500/30 group-hover:to-blue-500/30 transition-all">
              <Building2 className="w-5 h-5 text-brand-400" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold font-display text-foreground truncate group-hover:text-brand-300 transition-colors">
                    {job.job_title}
                  </h3>
                  <p className="text-sm text-muted-foreground truncate">
                    {job.company_name}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Status badge */}
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.bg} ${status.text} border border-current/20`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${status.dot} ${job.status === 'processing' ? 'animate-pulse' : ''}`} />
                    {job.status}
                  </span>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {job.location}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {leadCount} recruiter{leadCount !== 1 ? "s" : ""}
                </span>
                <a
                  href={job.job_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {extractDomain(job.job_url)}
                </a>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
                  <Clock className="w-3.5 h-3.5" />
                  {formatDateRelative(job.created_at)}
                </span>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(job); }}
                    title="Edit search"
                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-brand-400"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleRegenerate}
                    loading={regenerating}
                    title="Regenerate leads"
                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-brand-400"
                  >
                    {!regenerating && <RefreshCw className="w-3.5 h-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleDelete}
                    loading={deleting}
                    title="Delete job"
                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400"
                  >
                    {!deleting && <Trash2 className="w-3.5 h-3.5" />}
                  </Button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-brand-400 group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
