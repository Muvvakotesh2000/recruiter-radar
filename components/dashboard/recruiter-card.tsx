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
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Shield,
  FlaskConical,
  Send,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import type { RecruiterLead } from "@/types/database";
import {
  getConfidenceColor,
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

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
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
      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all flex-shrink-0"
      title={`Copy ${label}`}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── LinkedIn URL normaliser ──────────────────────────────────────────────────

function normaliseLinkedInUrl(url: string): string {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/^(\/in\/[^/]+)/);
    if (match) return `https://www.linkedin.com${match[1]}`;
  } catch { /* fall through */ }
  return url;
}

// ─── Outreach send button ─────────────────────────────────────────────────────

const LI_NOTE_LIMIT = 300;

function OutreachSendButton({ message, linkedinUrl }: { message: string; linkedinUrl: string | null }) {
  const [copied, setCopied] = useState(false);
  const connectionNote = message.length > LI_NOTE_LIMIT
    ? message.slice(0, LI_NOTE_LIMIT - 1).trimEnd() + "…"
    : message;
  const isTruncated = message.length > LI_NOTE_LIMIT;

  async function handleSend(e: React.MouseEvent) {
    e.stopPropagation();
    if (!linkedinUrl) { toast.error("No LinkedIn profile URL for this recruiter"); return; }
    await copyToClipboard(isTruncated ? connectionNote : message);
    toast.success(
      isTruncated
        ? `Message copied (trimmed to ${LI_NOTE_LIMIT} chars). Click Connect → Add a note → Ctrl+V`
        : "Message copied! Click Message or Connect → Add a note → Ctrl+V",
      { duration: 7000 }
    );
    setTimeout(() => window.open(normaliseLinkedInUrl(linkedinUrl), "_blank", "noopener,noreferrer"), 300);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  return (
    <button
      onClick={handleSend}
      disabled={!linkedinUrl}
      title={linkedinUrl ? "Copy message & open LinkedIn" : "No LinkedIn URL available"}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-brand-500/15 hover:bg-brand-500/25 border border-brand-500/25 hover:border-brand-500/50 transition-all text-brand-300 hover:text-brand-200 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Send className="w-3 h-3" />}
      Send
    </button>
  );
}

// ─── Main card ────────────────────────────────────────────────────────────────

const TOP_N = 5;

export function RecruiterCard({ lead, index, companyDomain }: RecruiterCardProps) {
  const [showOutreach, setShowOutreach] = useState(false);
  const [showPatterns, setShowPatterns] = useState(false);
  const [showEmailDropdown, setShowEmailDropdown] = useState(false);

  const confidenceColors = getConfidenceColor(lead.confidence_level);

  const { first: firstName, last: lastName } = splitName(lead.full_name);

  const allCandidates = companyDomain
    ? COMMON_PATTERNS
        .map(({ pattern, label, pct }) => ({
          label,
          pct,
          email: applyPattern(pattern, firstName, lastName, companyDomain),
        }))
        .filter(({ email }) => Boolean(email))
    : [];

  const topCandidates = allCandidates.slice(0, TOP_N);
  const moreCandidates = allCandidates.slice(TOP_N);

  const hasVerifiedEmail = lead.email && lead.email_type === "verified";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: "easeOut" }}
      className="relative glass rounded-2xl border border-border/50 hover:border-brand-500/30 transition-all duration-300 overflow-hidden group"
    >
      {/* Top accent bar */}
      <div className="h-0.5 bg-gradient-to-r from-brand-600 via-blue-500 to-brand-600 opacity-40 group-hover:opacity-80 transition-opacity" />

      <div className="p-5 space-y-4">

        {/* ── Header ── */}
        <div className="flex items-start gap-3.5">
          <Avatar className="h-12 w-12 flex-shrink-0 ring-2 ring-brand-500/20 group-hover:ring-brand-500/40 transition-all">
            <AvatarFallback className="bg-gradient-to-br from-brand-500/20 to-blue-500/20 text-sm font-bold text-brand-200">
              {getInitials(lead.full_name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-semibold text-base font-display text-foreground leading-tight truncate">
                  {lead.full_name}
                </h4>
                <p className="text-sm text-muted-foreground truncate mt-0.5">
                  {lead.recruiter_title}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 border ${confidenceColors.bg} ${confidenceColors.text} ${confidenceColors.border}`}>
                <Shield className="w-3 h-3" />
                {lead.confidence_level}
              </span>
            </div>
            {lead.location && (
              <div className="mt-1.5 flex items-center gap-1">
                <MapPin className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                <span className="text-xs text-muted-foreground/70 truncate">{lead.location}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Contact actions ── */}
        <div className="flex gap-2">
          {lead.linkedin_url && (
            <a
              href={normaliseLinkedInUrl(lead.linkedin_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/40 text-blue-400 hover:text-blue-300 text-xs font-medium transition-all"
            >
              <Linkedin className="w-3.5 h-3.5" />
              LinkedIn
              <ExternalLink className="w-3 h-3 opacity-50" />
            </a>
          )}

          {hasVerifiedEmail && (
            <div className="flex-1 flex items-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 min-w-0">
              <Mail className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              <span className="text-xs font-mono text-emerald-300 flex-1 truncate">{lead.email}</span>
              <CopyButton text={lead.email!} label="Email" />
            </div>
          )}
        </div>

        {/* ── Possible emails dropdown ── */}
        {topCandidates.length > 0 && (
          <div className="rounded-xl border border-border/40 overflow-hidden">
            <button
              onClick={() => setShowEmailDropdown((v) => !v)}
              className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-secondary/30 transition-colors"
            >
              <Mail className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
              <span className="flex-1 text-left text-xs font-medium text-brand-300">
                Possible Emails Found
              </span>
              <span className="text-xs text-muted-foreground/50 bg-secondary/60 px-1.5 py-0.5 rounded-full mr-1">
                {topCandidates.length}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0 transition-transform ${showEmailDropdown ? "rotate-180" : ""}`} />
            </button>

            {showEmailDropdown && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.2 }}
                className="border-t border-border/30"
              >
                {topCandidates.map(({ email }, i) => (
                  <div
                    key={email}
                    className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-secondary/30 transition-colors border-b border-border/20 last:border-0"
                  >
                    <span className="text-xs text-muted-foreground/30 w-4 text-center flex-shrink-0 tabular-nums">{i + 1}</span>
                    <span className="text-xs font-mono text-foreground/80 flex-1 truncate">{email}</span>
                    <CopyButton text={email} label={email} />
                  </div>
                ))}
              </motion.div>
            )}
          </div>
        )}

        {/* No contact info at all */}
        {!lead.linkedin_url && !hasVerifiedEmail && topCandidates.length === 0 && (
          <div className="flex items-center gap-2 py-1">
            <Mail className="w-4 h-4 text-muted-foreground/30 flex-shrink-0" />
            <span className="text-xs text-muted-foreground/40 italic">No contact info found</span>
          </div>
        )}

        {/* ── Outreach message ── */}
        <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 overflow-hidden">
          <button
            onClick={() => setShowOutreach(!showOutreach)}
            className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-brand-500/5 transition-colors"
          >
            <MessageSquare className="w-4 h-4 text-brand-400 flex-shrink-0" />
            <span className="text-sm font-medium text-brand-300 flex-1 text-left">Outreach Message</span>
            {lead.outreach_message && (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <CopyButton text={lead.outreach_message} label="Outreach message" />
                <OutreachSendButton message={lead.outreach_message} linkedinUrl={lead.linkedin_url} />
              </div>
            )}
            {showOutreach
              ? <ChevronUp className="w-4 h-4 text-brand-400/50 flex-shrink-0" />
              : <ChevronDown className="w-4 h-4 text-brand-400/50 flex-shrink-0" />}
          </button>

          {showOutreach && lead.outreach_message && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ duration: 0.2 }}
            >
              <div className="px-4 pb-4">
                <div className="h-px bg-brand-500/15 mb-3" />
                <pre className="text-xs text-foreground/70 whitespace-pre-wrap font-sans leading-relaxed">
                  {lead.outreach_message}
                </pre>
                {lead.outreach_message.length > LI_NOTE_LIMIT && (
                  <p className="mt-2.5 flex items-center gap-1.5 text-xs text-amber-400/70">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {lead.outreach_message.length} chars — Send auto-trims to {LI_NOTE_LIMIT} for connection notes
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </div>

        {/* ── More email patterns ── */}
        {moreCandidates.length > 0 && (
          <div>
            <button
              onClick={() => setShowPatterns(!showPatterns)}
              className="flex items-center gap-2 text-xs font-medium text-muted-foreground/50 hover:text-muted-foreground transition-colors w-full"
            >
              <FlaskConical className="w-3.5 h-3.5 text-amber-500/50" />
              <span className="flex-1 text-left">{moreCandidates.length} More Email Patterns</span>
              {showPatterns ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showPatterns && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.2 }}
                className="mt-2 rounded-lg border border-border/30 overflow-hidden"
              >
                {moreCandidates.map(({ email }) => (
                  <div
                    key={email}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/30 transition-colors border-b border-border/20 last:border-0"
                  >
                    <span className="text-xs font-mono text-foreground/50 flex-1 truncate">{email}</span>
                    <CopyButton text={email} label={email} />
                  </div>
                ))}
              </motion.div>
            )}
          </div>
        )}

        {/* ── Source ── */}
        <div className="flex items-center gap-1.5 pt-0.5">
          <span className="text-xs text-muted-foreground/30">via</span>
          <span className="text-xs text-muted-foreground/50 bg-secondary/40 px-2 py-0.5 rounded-full">{lead.source}</span>
        </div>

      </div>
    </motion.div>
  );
}
