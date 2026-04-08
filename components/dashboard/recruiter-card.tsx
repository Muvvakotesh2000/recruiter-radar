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
} from "lucide-react";
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
    // Copy the appropriate text first
    await copyToClipboard(isTruncated ? connectionNote : message);
    // Open their LinkedIn profile directly — "Message" / "Connect" is one click from here
    window.open(normaliseLinkedInUrl(linkedinUrl), "_blank", "noopener,noreferrer");
    toast.success(
      isTruncated
        ? `Message copied (trimmed to ${LI_NOTE_LIMIT} chars). Click Connect → Add a note → Ctrl+V`
        : "Message copied! Click Message or Connect → Add a note → Ctrl+V",
      { duration: 7000 }
    );
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

export function RecruiterCard({ lead, index, companyDomain }: RecruiterCardProps) {
  const [showOutreach, setShowOutreach] = useState(false);
  const [showPatterns, setShowPatterns] = useState(false);
  const confidenceColors = getConfidenceColor(lead.confidence_level);
  const emailTypeColors = getEmailTypeColor(lead.email_type);

  const emailCandidates = companyDomain
    ? (() => {
        const { first, last } = splitName(lead.full_name);
        return COMMON_PATTERNS.map(({ pattern, label }) => ({
          label,
          email: applyPattern(pattern, first, last, companyDomain),
        })).filter(({ email }) => email && email !== lead.email);
      })()
    : [];

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
                href={lead.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-400 hover:text-blue-300 flex-1 truncate transition-colors hover:underline"
              >
                View LinkedIn Profile
              </a>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
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
              <button
                onClick={() => setShowPatterns(!showPatterns)}
                className="flex items-center gap-2 text-sm font-medium text-amber-400 hover:text-amber-300 transition-colors w-full"
              >
                <FlaskConical className="w-4 h-4" />
                <span className="flex-1 text-left">
                  All Email Guesses
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    ({emailCandidates.length} patterns)
                  </span>
                </span>
                {showPatterns ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showPatterns && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-3"
                >
                  <p className="text-xs text-muted-foreground/60 mb-2 italic">
                    Unverified guesses — try each one manually
                  </p>
                  <div className="space-y-1.5">
                    {emailCandidates.map(({ label, email }) => (
                      <div
                        key={email}
                        className="flex items-center gap-2 bg-secondary/30 rounded-md px-2.5 py-1.5 border border-border/40"
                      >
                        <span className="text-xs text-muted-foreground/50 font-mono w-20 flex-shrink-0">
                          {label}
                        </span>
                        <span className="text-xs font-mono text-foreground/75 flex-1 truncate">
                          {email}
                        </span>
                        <CopyButton text={email} label={email} />
                      </div>
                    ))}
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
