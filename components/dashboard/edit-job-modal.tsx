"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Building2, Briefcase, Link as LinkIcon, MapPin, RefreshCw } from "lucide-react";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Job } from "@/types/database";

const EditJobSchema = z.object({
  company_name: z.string().min(1, "Company name is required").max(200),
  job_title: z.string().min(1, "Job title is required").max(200),
  job_url: z.string().min(1, "Job URL is required").url("Please enter a valid URL (include https://)"),
  location: z.string().min(1, "Location is required").max(200),
});

type EditJobInput = z.infer<typeof EditJobSchema>;

interface EditJobModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  onSuccess: () => void;
}

export function EditJobModal({ open, onOpenChange, job, onSuccess }: EditJobModalProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditJobInput>({
    resolver: zodResolver(EditJobSchema),
    defaultValues: {
      company_name: job.company_name,
      job_title: job.job_title,
      job_url: job.job_url,
      location: job.location,
    },
  });

  async function onSubmit(data: EditJobInput) {
    try {
      const res = await fetch("/api/generate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, ...data }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error);

      toast.success("Job updated & leads regenerated!", {
        description: `Found ${result.data.recruiter_count} recruiter${result.data.recruiter_count !== 1 ? "s" : ""}`,
      });
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update job";
      toast.error("Failed to update", { description: msg });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isSubmitting) onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="gradient-text-purple text-xl">Edit & Regenerate</DialogTitle>
          <DialogDescription>
            Update the job details and we&apos;ll search for recruiters again with the new information.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="edit_company_name">Company Name</Label>
            <Input
              id="edit_company_name"
              placeholder="e.g. Google, Stripe, OpenAI"
              icon={<Building2 className="w-4 h-4" />}
              {...register("company_name")}
              error={errors.company_name?.message}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit_job_title">Job Title</Label>
            <Input
              id="edit_job_title"
              placeholder="e.g. Senior Software Engineer"
              icon={<Briefcase className="w-4 h-4" />}
              {...register("job_title")}
              error={errors.job_title?.message}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit_location">Location</Label>
            <Input
              id="edit_location"
              placeholder="e.g. San Francisco, CA / New York, NY"
              icon={<MapPin className="w-4 h-4" />}
              {...register("location")}
              error={errors.location?.message}
            />
            <p className="text-xs text-muted-foreground">
              Separate multiple locations with <code className="text-violet-400">/</code> or comma.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit_job_url">Job URL</Label>
            <Input
              id="edit_job_url"
              type="url"
              placeholder="https://jobs.company.com/role/..."
              icon={<LinkIcon className="w-4 h-4" />}
              {...register("job_url")}
              error={errors.job_url?.message}
            />
          </div>

          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="gradient"
              className="flex-1 gap-2"
              loading={isSubmitting}
            >
              {!isSubmitting && <RefreshCw className="w-4 h-4" />}
              Save & Regenerate
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
