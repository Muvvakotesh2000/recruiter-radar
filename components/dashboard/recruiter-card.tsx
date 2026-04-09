"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Copy,
  Check,
  Linkedin,
  Mail,
  MapPin,
  ExternalLink,
  User,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Shield,
  FlaskConical,
  Send,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from "lucide-react";
import type { VerifyDomainResponse } from "@/app/api/verify-domain/route";
import type { RecruiterLead } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  getConfidenceColor,
  getEmailTypeColor,
  copyToClipboard,
  getInitials,
} from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { COMMON_PATTERNS, applyPattern, splitName } from "@/lib/utils/email-patterns";

interface RecruiterCardProps {
  lead: RecruiterLead;
  index: number;
  companyDomain?: string | null;
}

function CopyButton({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      toast.success(`${label} copied!`);
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Failed to copy");
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
      title={`Copy ${label}`}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

// LinkedIn connection request note max length
const LI_NOTE_LIMIT = 300;

/** Normalise a LinkedIn profile URL — ensure it ends cleanly */
function normaliseLinkedInUrl(url: string): string {
  try {
    const u = new URL(url);
    // Keep only origin + /in/{vanity}, strip query/hash
    const match = u.pathname.match(/^(\/in\/[^/]+)/);
    if (match) return `https://www.linkedin.com${match[1]}`;
  } catch { /* fall through */ }
  return url;
}

function OutreachSendButton({
  message,
  linkedinUrl,
}: {
  message: string;
  linkedinUrl: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const connectionNote = message.length > LI_NOTE_LIMIT
    ? message.slice(0, LI_NOTE_LIMIT - 1).trimEnd() + "…"
    : message;
  const isTruncated = message.length > LI_NOTE_LIMIT;

  async function handleSend(e: React.MouseEvent) {
    e.stopPropagation();
    if (!linkedinUrl) {
      toast.error("No LinkedIn profile URL for this recruiter");
      return;
    }
    // Copy first
    await copyToClipboard(isTruncated ? connectionNote : message);
    // Show toast before opening tab — browser shifts focus on window.open so toast must render first
    toast.success(
      isTruncated
        ? `Message copied (trimmed to ${LI_NOTE_LIMIT} chars). Click Connect → Add a note → Ctrl+V`
        : "Message copied! Click Message or Connect → Add a note → Ctrl+V",
      { duration: 7000 }
    );
    // Small delay so the toast paints, then open LinkedIn profile
    setTimeout(() => {
      window.open(normaliseLinkedInUrl(linkedinUrl), "_blank", "noopener,noreferrer");
    }, 300);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  return (
    <button
      onClick={handleSend}
      disabled={!linkedinUrl}
      title={linkedinUrl ? "Copy message & open LinkedIn" : "No LinkedIn URL available"}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/40 transition-all text-blue-400 hover:text-blue-300 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
    >
      {copied ? (
        <Check className="w-3 h-3 text-emerald-400" />
      ) : (
        <Send className="w-3 h-3" />
      )}
      Send
    </button>
  );
}


type VerifyState = "idle" | "checking" | "done" | "error";

export function RecruiterCard({ lead, index, companyDomain }: RecruiterCardProps) {
  const [showOutreach, setShowOutreach] = useState(false);
  const [showPatterns, setShowPatterns] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [verifyData, setVerifyData] = useState<VerifyDomainResponse | null>(null);
  const confidenceColors = getConfidenceColor(lead.confidence_level);
  const emailTypeColors = getEmailTypeColor(lead.email_type);

  const emailCandidates = companyDomain
    ? (() => {
        const { first, last } = splitName(lead.full_name);
        return COMMON_PATTERNS.map(({ pattern, label, pct }) => ({
          label,
          pct,
          email: applyPattern(pattern, first, last, companyDomain),
        })).filter(({ email }) => email && email !== lead.email);
      })()
    : [];

  async function handleVerify(e: React.MouseEvent) {
    e.stopPropagation();
    if (verifyState === "checking" || !companyDomain) return;
    setVerifyState("checking");
    setVerifyData(null);
    try {
      const res = await fetch("/api/verify-domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: companyDomain,
          emails: emailCandidates.map((c) => c.email),
        }),
      });
      const data: VerifyDomainResponse = await res.json();
      setVerifyData(data);
      setVerifyState("done");

      if (!data.mx) {
        toast.error("Domain has no mail servers — all patterns invalid");
      } else if (data.smtp_blocked) {
        toast.info("SMTP check blocked by host — showing domain + pattern ranking only");
      } else if (data.catch_all) {
        toast.warning("Catch-all domain — server accepts any address, showing pattern ranking");
      } else {
        const valid = Object.values(data.results).filter((r) => r === "accepted").length;
        toast.success(`Verification complete — ${valid} pattern${valid !== 1 ? "s" : ""} accepted`);
      }
    } catch {
      setVerifyState("error");
      toast.error("Verification failed");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: "easeOut" }}
      className="glass rounded-xl border border-border/50 hover:border-violet-500/25 transition-all duration-300 overflow-hidden group"
    >
      {/* Top gradient accent */}
      <div className="h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Avatar className="h-11 w-11 ring-2 ring-border group-hover:ring-violet-500/30 transition-all flex-shrink-0">
            <AvatarFallback className="text-sm">
              {getInitials(lead.full_name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-semibold font-display text-foreground truncate">
                  {lead.full_name}
                </h4>
                <p className="text-sm text-muted-foreground truncate">
                  {lead.recruiter_title}
                </p>
              </div>
              {/* Confidence badge */}
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 border ${confidenceColors.bg} ${confidenceColors.text} ${confidenceColors.border}`}
              >
                <Shield className="w-3 h-3" />
                {lead.confidence_level}
              </span>
            </div>
          </div>
        </div>

        {/* Location */}
        {lead.location && (
          <div className="mt-2 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
            <span className="text-xs text-muted-foreground">{lead.location}</span>
          </div>
        )}

        {/* Contact info */}
        <div className="mt-4 space-y-2.5">
          {/* Email */}
          {lead.email ? (
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm text-foreground/90 flex-1 truncate font-mono text-xs">
                {lead.email}
              </span>
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs border ${emailTypeColors.bg} ${emailTypeColors.text} ${emailTypeColors.border} flex-shrink-0`}
              >
                {lead.email_type === "verified"
                  ? "Confirmed"
                  : lead.email_type === "estimated"
                  ? "Via pattern"
                  : lead.email_type}
              </span>
              <CopyButton text={lead.email} label="Email" />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
              <span className="text-xs text-muted-foreground/50 italic">
                No email found
              </span>
            </div>
          )}

          {/* LinkedIn */}
          {lead.linkedin_url && (
            <div className="flex items-center gap-2">
              <Linkedin className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <a
                href={normaliseLinkedInUrl(lead.linkedin_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-400 hover:text-blue-300 flex-1 truncate transition-colors hover:underline"
              >
                View LinkedIn Profile
              </a>
              <a
                href={normaliseLinkedInUrl(lead.linkedin_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-all flex-shrink-0"
                title="Open LinkedIn profile"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <CopyButton text={lead.linkedin_url} label="LinkedIn URL" />
            </div>
          )}

          {/* Source */}
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground truncate">
              Source: {lead.source}
            </span>
          </div>
        </div>

        <Separator className="my-4" />

        {/* Outreach message row — Copy + Send always visible */}
        <div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowOutreach(!showOutreach)}
              className="flex items-center gap-2 text-sm font-medium text-violet-400 hover:text-violet-300 transition-colors flex-1 min-w-0"
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">Outreach Message</span>
              {showOutreach ? (
                <ChevronUp className="w-4 h-4 flex-shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 flex-shrink-0" />
              )}
            </button>

            {lead.outreach_message && (
              <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                <CopyButton text={lead.outreach_message} label="Outreach message" />
                <OutreachSendButton
                  message={lead.outreach_message}
                  linkedinUrl={lead.linkedin_url}
                />
              </div>
            )}
          </div>

          {showOutreach && lead.outreach_message && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="mt-3"
            >
              <div className="bg-secondary/40 rounded-lg p-3.5 border border-border/50">
                <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-sans leading-relaxed">
                  {lead.outreach_message}
                </pre>
              </div>
              {lead.outreach_message.length > LI_NOTE_LIMIT && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-400/80">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {lead.outreach_message.length} chars — Send auto-trims to {LI_NOTE_LIMIT} for connection notes
                </p>
              )}
            </motion.div>
          )}
        </div>

        {/* All email pattern candidates */}
        {emailCandidates.length > 0 && (
          <>
            <Separator className="my-4" />
            <div>
              {/* Header row */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPatterns(!showPatterns)}
                  className="flex items-center gap-2 text-sm font-medium text-amber-400 hover:text-amber-300 transition-colors flex-1 min-w-0"
                >
                  <FlaskConical className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 text-left truncate">
                    Email Patterns
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      ({emailCandidates.length} patterns)
                    </span>
                  </span>
                  {showPatterns ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
                </button>

                {/* Single verify-all button */}
                <button
                  onClick={handleVerify}
                  disabled={verifyState === "checking"}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition-all flex-shrink-0 disabled:opacity-50
                    border-amber-500/30 text-amber-400/80 hover:text-amber-300 hover:border-amber-400/50 hover:bg-amber-500/5"
                  title="Syntax → MX → SMTP → catch-all detection"
                >
                  {verifyState === "checking" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3 h-3" />
                  )}
                  {verifyState === "checking" ? "Checking…" : verifyState === "done" ? "Re-verify" : "Verify All"}
                </button>
              </div>

              {showPatterns && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-3"
                >
                  {/* Status banner */}
                  {verifyData && (
                    <div className={`mb-2 px-2.5 py-1.5 rounded-md text-xs border ${
                      !verifyData.mx
                        ? "bg-red-500/10 border-red-500/20 text-red-400"
                        : verifyData.catch_all
                        ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                        : verifyData.smtp_blocked
                        ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                        : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    }`}>
                      {!verifyData.mx && "✗ Domain has no mail servers — all patterns invalid"}
                      {verifyData.mx && verifyData.catch_all && "⚠ Catch-all domain — server accepts any address, showing pattern ranking"}
                      {verifyData.mx && verifyData.smtp_blocked && !verifyData.catch_all && "ℹ SMTP probe blocked by host — showing MX + pattern ranking"}
                      {verifyData.mx && !verifyData.catch_all && !verifyData.smtp_blocked && "✓ SMTP check complete"}
                    </div>
                  )}

                  {!verifyData && (
                    <p className="text-xs text-muted-foreground/60 mb-2 italic">
                      Click Verify All — runs syntax → MX → SMTP → catch-all detection
                    </p>
                  )}

                  <div className="space-y-1.5">
                    {emailCandidates.map(({ label, email, pct }) => {
                      const smtpResult = verifyData?.results?.[email];
                      const showSmtp = verifyData && !verifyData.smtp_blocked && !verifyData.catch_all && verifyData.mx;

                      return (
                        <div
                          key={email}
                          className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 border transition-colors ${
                            showSmtp && smtpResult === "accepted"
                              ? "bg-emerald-500/10 border-emerald-500/30"
                              : showSmtp && smtpResult === "rejected"
                              ? "bg-red-500/10 border-red-500/20 opacity-50"
                              : "bg-secondary/30 border-border/40"
                          }`}
                        >
                          <span className="text-xs text-muted-foreground/50 font-mono w-20 flex-shrink-0">
                            {label}
                          </span>
                          <span className="text-xs font-mono text-foreground/75 flex-1 truncate">
                            {email}
                          </span>

                          {/* Result badge */}
                          {showSmtp && smtpResult === "accepted" && (
                            <span className="flex items-center gap-1 text-xs text-emerald-400 flex-shrink-0">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Valid
                            </span>
                          )}
                          {showSmtp && smtpResult === "rejected" && (
                            <span className="flex items-center gap-1 text-xs text-red-400 flex-shrink-0">
                              <XCircle className="w-3.5 h-3.5" /> Invalid
                            </span>
                          )}
                          {showSmtp && smtpResult === "unknown" && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground/50 flex-shrink-0">
                              <HelpCircle className="w-3.5 h-3.5" /> Unknown
                            </span>
                          )}

                          {/* Fallback: prevalence % when SMTP blocked, catch-all, or not yet verified */}
                          {(!verifyData || verifyData.smtp_blocked || verifyData.catch_all || !verifyData.mx) && (
                            <span
                              title="Prevalence across business email domains"
                              className={`text-xs font-medium flex-shrink-0 tabular-nums ${
                                pct >= 20 ? "text-emerald-400" : pct >= 5 ? "text-amber-400" : "text-muted-foreground/50"
                              }`}
                            >
                              {pct > 0 ? `${pct}%` : "<1%"}
                            </span>
                          )}

                          <CopyButton text={email} label={email} />
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
