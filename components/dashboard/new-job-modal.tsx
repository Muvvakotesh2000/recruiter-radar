"use client";

import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2,
  Briefcase,
  Globe,
  Link as LinkIcon,
  Loader2,
  MapPin,
  Pencil,
  Sparkles,
  ExternalLink,
} from "lucide-react";
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

type ModalMode = "url" | "preview" | "editing";

const GENERATING_STEPS = [
  "Creating your search job...",
  "Preparing AI search queries...",
  "Starting background search...",
];

export function NewJobModal({ open, onOpenChange, onSuccess }: NewJobModalProps) {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingText, setGeneratingText] = useState("");
  const [mode, setMode] = useState<ModalMode>("url");
  const [isRemote, setIsRemote] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
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
  const watchedValues = watch();

  // Auto-fill when a valid URL is pasted (only in url mode)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!jobUrl || !jobUrl.startsWith("http") || mode !== "url") return;

    debounceRef.current = setTimeout(async () => {
      setAutofilling(true);
      try {
        const res = await fetch(`/api/parse-job?url=${encodeURIComponent(jobUrl)}`);
        const json = await res.json();

        if (json.success && json.data) {
          const { company_name: co, job_title: jt, location: loc, is_remote: remote } = json.data;

          if (co) setValue("company_name", co, { shouldValidate: true });
          if (jt) setValue("job_title", jt, { shouldValidate: true });

          if (remote) {
            setIsRemote(true);
            setValue("location", "Remote", { shouldValidate: true });
          } else if (loc) {
            setValue("location", loc, { shouldValidate: true });
          }

          // Switch to preview if we got at least company or title
          if (co || jt) {
            setMode("preview");
          } else {
            // Got a URL response but no useful data — go straight to editing
            setMode("editing");
          }
        } else {
          // Parse failed — let user fill manually
          setMode("editing");
        }
      } catch {
        setMode("editing");
      } finally {
        setAutofilling(false);
      }
    }, 600);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobUrl]);

  function handleRemoteToggle(checked: boolean) {
    setIsRemote(checked);
    setValue("location", checked ? "Remote" : "", { shouldValidate: checked });
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
      if (!result.success) throw new Error(result.error || "Generation failed");

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
    setMode("url");
    setIsRemote(false);
    setAutofilling(false);
    onOpenChange(false);
  }

  const canSubmit = mode === "preview" ||
    (mode === "editing" && !!watchedValues.company_name && !!watchedValues.job_title && !!watchedValues.location);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        {isGenerating ? (
          <GeneratingState text={generatingText} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="gradient-text-purple text-xl">Find Recruiters</DialogTitle>
              <DialogDescription>
                {mode === "url"
                  ? "Paste a job URL — we'll fill in the rest automatically."
                  : mode === "preview"
                  ? "Review the details below, then find recruiters."
                  : "Fill in the job details manually."}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-2 space-y-4">

              {/* ── URL field — always visible ── */}
              <div className="space-y-2">
                <Label htmlFor="job_url">Job URL</Label>
                <div className="relative">
                  <Input
                    id="job_url"
                    type="url"
                    placeholder="https://jobs.company.com/role/..."
                    icon={
                      autofilling
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <LinkIcon className="w-4 h-4" />
                    }
                    autoFocus={mode === "url"}
                    {...register("job_url")}
                    error={errors.job_url?.message}
                  />
                </div>
                {mode === "url" && !autofilling && (
                  <p className="text-xs text-muted-foreground">
                    Paste the full URL from LinkedIn, Greenhouse, Lever, etc.
                  </p>
                )}
                {autofilling && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Reading job page…
                  </p>
                )}
              </div>

              {/* ── Preview card (after auto-fill) ── */}
              <AnimatePresence>
                {mode === "preview" && (
                  <motion.div
                    key="preview"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.22 }}
                    className="rounded-xl border border-brand-500/20 bg-brand-400/5 p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-brand-400 uppercase tracking-wide">
                        Detected details
                      </p>
                      <button
                        type="button"
                        onClick={() => setMode("editing")}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        Edit
                      </button>
                    </div>

                    <div className="space-y-2">
                      {watchedValues.company_name && (
                        <div className="flex items-center gap-2 text-sm">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="font-medium text-foreground">{watchedValues.company_name}</span>
                        </div>
                      )}
                      {watchedValues.job_title && (
                        <div className="flex items-center gap-2 text-sm">
                          <Briefcase className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="text-foreground">{watchedValues.job_title}</span>
                        </div>
                      )}
                      {watchedValues.location && (
                        <div className="flex items-center gap-2 text-sm">
                          {isRemote
                            ? <Globe className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                            : <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          }
                          <span className={isRemote ? "text-emerald-400" : "text-foreground"}>
                            {watchedValues.location}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-sm">
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <a
                          href={watchedValues.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground truncate max-w-xs transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {watchedValues.job_url}
                        </a>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Editing fields ── */}
              <AnimatePresence>
                {mode === "editing" && (
                  <motion.div
                    key="editing"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.22 }}
                    className="space-y-4"
                  >
                    <div className="space-y-2">
                      <Label htmlFor="company_name">Company Name</Label>
                      <Input
                        id="company_name"
                        placeholder="e.g. Google, Stripe, OpenAI"
                        icon={<Building2 className="w-4 h-4" />}
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
                        {!isRemote ? (
                          <motion.div
                            key="loc-input"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.18 }}
                            className="overflow-hidden"
                          >
                            <Input
                              id="location"
                              placeholder="e.g. San Francisco, CA"
                              icon={<MapPin className="w-4 h-4" />}
                              {...register("location")}
                              error={errors.location?.message}
                            />
                            <p className="text-xs text-muted-foreground mt-1.5">
                              Separate multiple locations with <code className="text-brand-400">/</code> or comma.
                            </p>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="loc-remote"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.18 }}
                            className="overflow-hidden"
                          >
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
                              <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                              Searching company-wide — no location filter applied
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Submit ── */}
              <AnimatePresence>
                {(mode === "preview" || mode === "editing") && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Button
                      type="submit"
                      variant="gradient"
                      className="w-full gap-2 h-11"
                      disabled={!canSubmit}
                    >
                      <Sparkles className="w-4 h-4" />
                      Find Recruiters
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>

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
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="7" strokeDasharray="2 3" />
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
