"use client";

import { motion } from "framer-motion";
import { Link2, Cpu, Users, Send } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: Link2,
    title: "Paste the job URL",
    description:
      "Copy the job listing URL from LinkedIn, Greenhouse, Lever, or any job board. Add the company, role, and location.",
    color: "from-brand-600 to-brand-600",
  },
  {
    number: "02",
    icon: Cpu,
    title: "AI does the research",
    description:
      "Our AI searches across LinkedIn, Apollo, RocketReach, and more to identify the most relevant recruiters for your specific role.",
    color: "from-blue-600 to-cyan-600",
  },
  {
    number: "03",
    icon: Users,
    title: "Review recruiter profiles",
    description:
      "Get a curated list of recruiters with confidence scores, contact info, email patterns, and hiring team notes.",
    color: "from-cyan-600 to-emerald-600",
  },
  {
    number: "04",
    icon: Send,
    title: "Send your outreach",
    description:
      "Each lead comes with a personalized message ready to send. Copy it directly and reach out to the decision-maker.",
    color: "from-emerald-600 to-brand-600",
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-28 relative">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400 font-medium mb-4">
            How it works
          </span>
          <h2 className="font-display text-4xl sm:text-5xl font-bold text-white mb-4">
            From job post to recruiter contact{" "}
            <span className="gradient-text-brand">in 30 seconds</span>
          </h2>
          <p className="text-xl text-zinc-400 max-w-xl mx-auto">
            Four simple steps. No manual research. No guessing.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="relative">
          {/* Connecting line */}
          <div className="absolute left-[27px] top-10 bottom-10 w-px bg-gradient-to-b from-brand-600/40 via-blue-600/40 to-emerald-600/40 hidden sm:block" />

          <div className="space-y-10">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <motion.div
                  key={step.number}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.15, duration: 0.5, ease: "easeOut" }}
                  className="flex items-start gap-6 sm:gap-8"
                >
                  {/* Icon */}
                  <div className="relative flex-shrink-0">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center shadow-lg z-10 relative`}>
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 pt-1">
                    <div className="flex items-baseline gap-3 mb-2">
                      <span className="text-xs font-mono text-muted-foreground/60">
                        {step.number}
                      </span>
                      <h3 className="font-display text-xl font-bold text-white">
                        {step.title}
                      </h3>
                    </div>
                    <p className="text-zinc-400 leading-relaxed">{step.description}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
