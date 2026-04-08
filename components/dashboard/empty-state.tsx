"use client";

import { motion } from "framer-motion";
import { Radar, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  onAddJob: () => void;
}

export function EmptyState({ onAddJob }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="flex flex-col items-center justify-center py-24 px-8 text-center"
    >
      {/* Animated icon */}
      <div className="relative mb-8">
        <div className="absolute inset-0 rounded-full bg-violet-500/10 animate-ping" style={{ animationDuration: '3s' }} />
        <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-violet-600/20 to-blue-600/20 border border-violet-500/20 flex items-center justify-center">
          <Radar className="w-10 h-10 text-violet-400" />
        </div>
      </div>

      <h2 className="font-display text-2xl font-bold text-foreground mb-3">
        No recruiter leads yet
      </h2>
      <p className="text-muted-foreground max-w-sm mb-8 leading-relaxed">
        Start by adding a job you&apos;re interested in. Our AI will find the recruiters and hiring managers most likely to get you an interview.
      </p>

      {/* Feature list */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10 max-w-2xl w-full">
        {[
          { icon: "🎯", title: "Targeted search", desc: "AI finds recruiters for your specific role" },
          { icon: "📧", title: "Email discovery", desc: "Get verified or estimated contact emails" },
          { icon: "✍️", title: "Ready-to-send", desc: "Personalized outreach messages included" },
        ].map((feature) => (
          <div
            key={feature.title}
            className="glass rounded-xl p-4 border border-border/50 text-left"
          >
            <span className="text-2xl">{feature.icon}</span>
            <p className="font-semibold text-sm mt-2 mb-1">{feature.title}</p>
            <p className="text-xs text-muted-foreground">{feature.desc}</p>
          </div>
        ))}
      </div>

      <Button
        onClick={onAddJob}
        variant="gradient"
        size="lg"
        className="gap-2 shadow-glow"
      >
        <Sparkles className="w-4 h-4" />
        Find My First Recruiters
      </Button>
    </motion.div>
  );
}
