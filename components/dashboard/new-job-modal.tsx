"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, Briefcase, Link as LinkIcon, MapPin, Sparkles, User } from "lucide-react";
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
import { JobSubmitSchema, type JobSubmitInput } from "@/lib/validations/job";

interface NewJobModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const GENERATING_STEPS = [
  "Creating your search job...",
  "Preparing AI search queries...",
  "Starting background search...",
];

export function NewJobModal({ open, onOpenChange, onSuccess }: NewJobModalProps) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingText, setGeneratingText] = useState("");

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
  } = useForm<JobSubmitInput>({
    resolver: zodResolver(JobSubmitSchema),
  });

  const jobUrl = watch("job_url", "");
  const isLinkedIn = jobUrl.includes("linkedin.com/jobs");

  async function onSubmit(data: JobSubmitInput) {
    setIsGenerating(true);

    let msgIdx = 0;
    setGeneratingText(GENERATING_STEPS[0]);
    const interval = setInterval(() => {
      msgIdx = (msgIdx + 1) % GENERATING_STEPS.length;
      setGeneratingText(GENERATING_STEPS[msgIdx]);
    }, 800);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Generation failed");
      }

      toast.success("Search started!", {
        description: "Finding recruiters in the background. Results will appear automatically.",
      });

      reset();
      onOpenChange(false);
      onSuccess();
      router.push(`/dashboard/${result.data.job_id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong";
      toast.error("Generation failed", { description: message });
    } finally {
      clearInterval(interval);
      setIsGenerating(false);
      setGeneratingText("");
    }
  }

  function handleClose() {
    if (isGenerating) return;
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        {isGenerating ? (
          <GeneratingState text={generatingText} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="gradient-text-purple text-xl">
                Find Recruiters
              </DialogTitle>
              <DialogDescription>
                Enter the job details and we&apos;ll search for the right people to contact.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="company_name">Company Name</Label>
                <Input
                  id="company_name"
                  placeholder="e.g. Google, Stripe, OpenAI"
                  icon={<Building2 className="w-4 h-4" />}
                  autoFocus
                  {...register("company_name")}
                  error={errors.company_name?.message}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="job_title">Job Title</Label>
                <Input
                  id="job_title"
                  placeholder="e.g. Senior Software Engineer"
                  icon={<Briefcase className="w-4 h-4" />}
                  {...register("job_title")}
                  error={errors.job_title?.message}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  placeholder="e.g. San Francisco, CA / New York, NY"
                  icon={<MapPin className="w-4 h-4" />}
                  {...register("location")}
                  error={errors.location?.message}
                />
                <p className="text-xs text-muted-foreground">
                  Separate multiple locations with <code className="text-brand-400">/</code> or comma. Recruiters in your locations are prioritized.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="job_url">Job URL</Label>
                <Input
                  id="job_url"
                  type="url"
                  placeholder="https://jobs.company.com/role/..."
                  icon={<LinkIcon className="w-4 h-4" />}
                  {...register("job_url")}
                  error={errors.job_url?.message}
                />
                <p className="text-xs text-muted-foreground">
                  Paste the full URL from LinkedIn, Greenhouse, Lever, etc.
                </p>
              </div>

              {isLinkedIn && (
                <div className="space-y-2">
                  <Label htmlFor="recruiter_hint">
                    Recruiter Name{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="recruiter_hint"
                    placeholder="e.g. Sarah Chen"
                    icon={<User className="w-4 h-4" />}
                    {...register("recruiter_hint")}
                    error={errors.recruiter_hint?.message}
                  />
                  <p className="text-xs text-muted-foreground">
                    Found under <span className="text-brand-400">"Meet the Hiring Team"</span> on the LinkedIn job page. Paste their name for a direct match.
                  </p>
                </div>
              )}

              <Button
                type="submit"
                variant="gradient"
                className="w-full gap-2 h-11"
              >
                <Sparkles className="w-4 h-4" />
                Find Recruiters
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GeneratingState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-6">
      <div className="relative w-24 h-24 flex items-center justify-center">
        <div className="absolute inset-0 rounded-full border-2 border-brand-500/20 animate-ping" />
        <div className="absolute inset-2 rounded-full border-2 border-brand-500/30 animate-ping [animation-delay:0.3s]" />
        <div className="absolute inset-4 rounded-full border-2 border-brand-500/40 animate-ping [animation-delay:0.6s]" />
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-600 to-blue-600 flex items-center justify-center z-10 shadow-glow">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <circle cx="12" cy="12" r="7" strokeDasharray="2 3"/>
          </svg>
        </div>
      </div>

      <div className="text-center space-y-2">
        <h3 className="font-display font-semibold text-lg text-foreground">
          Searching for recruiters...
        </h3>
        <AnimatePresence mode="wait">
          <motion.p
            key={text}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="text-sm text-muted-foreground"
          >
            {text}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="w-48 h-1 bg-secondary rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-brand-600 to-blue-600 rounded-full animate-pulse w-3/4" />
      </div>

      <p className="text-xs text-muted-foreground max-w-xs text-center">
        Searching Google, LinkedIn, and contact databases. This takes 15–30 seconds.
      </p>
    </div>
  );
}
