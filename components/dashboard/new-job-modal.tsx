"use client";

import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, Briefcase, Globe, Link as LinkIcon, Loader2, MapPin, Sparkles, Wand2 } from "lucide-react";
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

  const [isRemote, setIsRemote] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [autofilled, setAutofilled] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
    reset,
  } = useForm<JobSubmitInput>({
    resolver: zodResolver(JobSubmitSchema),
  });

  const jobUrl = watch("job_url", "");

  // Auto-fill fields when a valid URL is pasted
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Only trigger for plausible URLs
    if (!jobUrl || !jobUrl.startsWith("http")) {
      setAutofilled(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      // Skip if company + title are already filled by the user
      const { company_name, job_title } = getValues();
      if (company_name?.trim() && job_title?.trim()) return;

      setAutofilling(true);
      setAutofilled(false);
      try {
        const res = await fetch(`/api/parse-job?url=${encodeURIComponent(jobUrl)}`);
        const json = await res.json();
        if (!json.success || !json.data) return;

        const { company_name: co, job_title: jt, location: loc, is_remote: remote } = json.data;

        let filled = false;
        if (co && !getValues("company_name")?.trim()) {
          setValue("company_name", co, { shouldValidate: true });
          filled = true;
        }
        if (jt && !getValues("job_title")?.trim()) {
          setValue("job_title", jt, { shouldValidate: true });
          filled = true;
        }
        if (remote) {
          setIsRemote(true);
          setValue("location", "Remote", { shouldValidate: true });
          filled = true;
        } else if (loc && !getValues("location")?.trim()) {
          setValue("location", loc, { shouldValidate: true });
          filled = true;
        }

        if (filled) setAutofilled(true);
      } catch {
        // silently ignore — user fills manually
      } finally {
        setAutofilling(false);
      }
    }, 600);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobUrl]);

  function handleRemoteToggle(checked: boolean) {
    setIsRemote(checked);
    if (checked) {
      setValue("location", "Remote", { shouldValidate: true });
    } else {
      setValue("location", "", { shouldValidate: false });
    }
  }

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
    setIsRemote(false);
    setAutofilled(false);
    setAutofilling(false);
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
              {/* Job URL first — triggers auto-fill */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="job_url">Job URL</Label>
                  <AnimatePresence>
                    {autofilling && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-1 text-xs text-muted-foreground"
                      >
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Filling details…
                      </motion.span>
                    )}
                    {autofilled && !autofilling && (
                      <motion.span
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-1 text-xs text-brand-400"
                      >
                        <Wand2 className="w-3 h-3" />
                        Auto-filled
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <Input
                  id="job_url"
                  type="url"
                  placeholder="https://jobs.company.com/role/..."
                  icon={<LinkIcon className="w-4 h-4" />}
                  autoFocus
                  {...register("job_url")}
                  error={errors.job_url?.message}
                />
                <p className="text-xs text-muted-foreground">
                  Paste the full URL — we&apos;ll try to fill the details automatically.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="company_name">Company Name</Label>
                <Input
                  id="company_name"
                  placeholder="e.g. Google, Stripe, OpenAI"
                  icon={autofilling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
                  {...register("company_name")}
                  error={errors.company_name?.message}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="job_title">Job Title</Label>
                <Input
                  id="job_title"
                  placeholder="e.g. Senior Software Engineer"
                  icon={autofilling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Briefcase className="w-4 h-4" />}
                  {...register("job_title")}
                  error={errors.job_title?.message}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="location">Location</Label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none group">
                    <input
                      type="checkbox"
                      checked={isRemote}
                      onChange={(e) => handleRemoteToggle(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-brand-500 cursor-pointer"
                    />
                    <span className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                      <Globe className="w-3 h-3" />
                      Remote
                    </span>
                  </label>
                </div>
                <AnimatePresence initial={false}>
                  {!isRemote && (
                    <motion.div
                      key="location-input"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <Input
                        id="location"
                        placeholder="e.g. San Francisco, CA / New York, NY"
                        icon={autofilling ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                        {...register("location")}
                        error={errors.location?.message}
                      />
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Separate multiple locations with <code className="text-brand-400">/</code> or comma.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
                {isRemote && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
                    <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                    Searching company-wide — no location filter applied
                  </div>
                )}
              </div>

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
        <div className="w-12 h-12 rounded-full bg-brand-400 flex items-center justify-center z-10 shadow-glow">
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
        <div className="h-full bg-brand-400 rounded-full animate-pulse w-3/4" />
      </div>

      <p className="text-xs text-muted-foreground max-w-xs text-center">
        Searching Google, LinkedIn, and contact databases. This takes 15–30 seconds.
      </p>
    </div>
  );
}
