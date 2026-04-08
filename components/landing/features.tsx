"use client";

import { motion } from "framer-motion";
import {
  Search,
  Mail,
  MessageSquare,
  Shield,
  Zap,
  GitBranch,
  Copy,
  RefreshCw,
} from "lucide-react";

const features = [
  {
    icon: Search,
    title: "Multi-source search",
    description:
      "Searches LinkedIn, company pages, Apollo, RocketReach, and Hunter patterns to find the most relevant contacts.",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
  },
  {
    icon: Mail,
    title: "Email discovery",
    description:
      "Finds verified emails or uses company email patterns to generate the most likely address for each recruiter.",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  {
    icon: MessageSquare,
    title: "Outreach messages",
    description:
      "Every recruiter comes with a ready-to-send, personalized outreach message tailored to the specific role.",
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
  },
  {
    icon: Shield,
    title: "Confidence scoring",
    description:
      "Each lead is scored High, Medium, or Low confidence based on how directly they match your target role.",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  {
    icon: Zap,
    title: "Multi-AI support",
    description:
      "Pluggable AI providers: xAI Grok, OpenAI GPT-4o, Anthropic Claude, and Google Gemini — switchable per request.",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  {
    icon: GitBranch,
    title: "Persistent history",
    description:
      "All your jobs and recruiter leads are saved per account. Pick up where you left off at any time.",
    color: "text-pink-400",
    bg: "bg-pink-500/10",
    border: "border-pink-500/20",
  },
  {
    icon: Copy,
    title: "One-click copy",
    description:
      "Copy email, LinkedIn URL, or outreach message instantly. Or copy all emails at once.",
    color: "text-indigo-400",
    bg: "bg-indigo-500/10",
    border: "border-indigo-500/20",
  },
  {
    icon: RefreshCw,
    title: "Regenerate leads",
    description:
      "Not happy with the results? Regenerate with a different AI provider with one click.",
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/20",
  },
];

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

export function FeaturesSection() {
  return (
    <section id="features" className="py-28 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-violet-950/5 to-transparent pointer-events-none" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-xs text-violet-400 font-medium mb-4">
            Everything you need
          </span>
          <h2 className="font-display text-4xl sm:text-5xl font-bold text-white mb-4">
            Built for serious{" "}
            <span className="gradient-text">job seekers</span>
          </h2>
          <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
            Stop guessing who to reach out to. RecruiterRadar gives you everything
            needed to land in the right inbox.
          </p>
        </motion.div>

        {/* Feature grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={feature.title}
                variants={cardVariants}
                className={`glass rounded-xl p-5 border ${feature.border} hover:shadow-card-hover transition-all duration-300 group`}
              >
                <div
                  className={`w-10 h-10 rounded-xl ${feature.bg} border ${feature.border} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}
                >
                  <Icon className={`w-5 h-5 ${feature.color}`} />
                </div>
                <h3 className="font-display font-semibold text-white mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  {feature.description}
                </p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
