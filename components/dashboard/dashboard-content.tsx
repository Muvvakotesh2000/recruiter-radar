"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Plus, Search, Sparkles, SlidersHorizontal } from "lucide-react";
import type { JobWithLeadCount } from "@/lib/services/jobs";
import { DashboardMetrics } from "./dashboard-metrics";
import { JobCard } from "./job-card";
import { EmptyState } from "./empty-state";
import { NewJobModal } from "./new-job-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MetricsData {
  totalJobs: number;
  completedJobs: number;
  totalLeads: number;
  highConfidenceLeads: number;
  leadsWithEmail: number;
}

interface DashboardContentProps {
  initialJobs: JobWithLeadCount[];
  metrics: MetricsData;
  userId: string;
}

export function DashboardContent({
  initialJobs,
  metrics,
  userId,
}: DashboardContentProps) {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobWithLeadCount[]>(initialJobs);

  // Sync state when server re-renders with fresh data (after router.refresh())
  useEffect(() => {
    setJobs(initialJobs);
  }, [initialJobs]);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const handleDelete = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  const handleRegenerate = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleSuccess = useCallback(() => {
    router.refresh();
  }, [router]);

  const filteredJobs = jobs.filter((job) => {
    const matchesSearch =
      !search ||
      job.company_name.toLowerCase().includes(search.toLowerCase()) ||
      job.job_title.toLowerCase().includes(search.toLowerCase()) ||
      job.location.toLowerCase().includes(search.toLowerCase());

    const matchesStatus =
      statusFilter === "all" || job.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const currentMetrics = {
    ...metrics,
    totalJobs: jobs.length,
  };

  return (
    <div className="min-h-screen mesh-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        >
          <div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-foreground">
              Recruiter Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {jobs.length === 0
                ? "Add your first job to start finding recruiters"
                : `${jobs.length} job${jobs.length !== 1 ? "s" : ""} tracked`}
            </p>
          </div>
          <Button
            onClick={() => setModalOpen(true)}
            variant="gradient"
            className="gap-2 shadow-glow self-start sm:self-auto"
          >
            <Sparkles className="w-4 h-4" />
            Find Recruiters
          </Button>
        </motion.div>

        {/* Metrics */}
        {jobs.length > 0 && <DashboardMetrics metrics={currentMetrics} />}

        {/* Search and filter bar */}
        {jobs.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
          >
            <div className="relative flex-1 max-w-md">
              <Input
                placeholder="Search jobs, companies, locations..."
                icon={<Search className="w-4 h-4" />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-4"
              />
            </div>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              {(["all", "completed", "pending", "failed"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${
                    statusFilter === status
                      ? "bg-violet-600 text-white"
                      : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Job list / empty state */}
        {jobs.length === 0 ? (
          <EmptyState onAddJob={() => setModalOpen(true)} />
        ) : filteredJobs.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No jobs match your search</p>
            <p className="text-sm mt-1">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredJobs.map((job, index) => (
              <JobCard
                key={job.id}
                job={job}
                leadCount={job.lead_count}
                onDelete={handleDelete}
                onRegenerate={handleRegenerate}
                index={index}
              />
            ))}
          </div>
        )}

        {/* Quick add FAB on mobile */}
        <button
          onClick={() => setModalOpen(true)}
          className="fixed bottom-6 right-6 sm:hidden w-14 h-14 rounded-full bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center shadow-glow-lg text-white z-30 hover:scale-110 active:scale-95 transition-transform"
          aria-label="Find Recruiters"
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>

      <NewJobModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
