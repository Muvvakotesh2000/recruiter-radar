"use client";

import { motion } from "framer-motion";

const steps = [
  {
    number: "01",
    title: "Paste the job URL",
    description: "LinkedIn, Greenhouse, Lever, Workday — any job board works. Add the company name and location.",
  },
  {
    number: "02",
    title: "We find the recruiter",
    description: "Searches LinkedIn profiles, Apollo, and contact databases. Usually takes under 30 seconds.",
  },
  {
    number: "03",
    title: "Reach out",
    description: "You get their LinkedIn, an estimated email, and a personalized message. Copy and send.",
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-24 border-t border-border/30">
      <div className="max-w-5xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-16"
        >
          <p className="text-brand-400 text-sm font-medium tracking-wide uppercase mb-3">How it works</p>
          <h2 className="font-display text-4xl font-bold text-white">
            Three steps. That's it.
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8 md:gap-12">
          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.12, duration: 0.5 }}
            >
              <span className="font-mono text-4xl font-bold text-brand-400/30 block mb-4">
                {step.number}
              </span>
              <h3 className="font-display text-lg font-bold text-white mb-2">
                {step.title}
              </h3>
              <p className="text-zinc-400 leading-relaxed text-sm">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
