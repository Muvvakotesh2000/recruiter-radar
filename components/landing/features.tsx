"use client";

import { motion } from "framer-motion";
import { MapPin, Mail, MessageSquare } from "lucide-react";

const features = [
  {
    icon: MapPin,
    title: "Location-first matching",
    description: "Prioritizes recruiters actually based in your city or metro area — not just anyone with the company name on their profile.",
  },
  {
    icon: Mail,
    title: "Email estimation",
    description: "Uses Hunter.io domain data and company email patterns to give you a real address to send to, not just a LinkedIn DM.",
  },
  {
    icon: MessageSquare,
    title: "Ready-to-send message",
    description: "Every lead comes with a short, personal outreach message. Not a template — it's tailored to the role, company, and recruiter.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="py-24 border-t border-border/30">
      <div className="max-w-5xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-16"
        >
          <p className="text-brand-400 text-sm font-medium tracking-wide uppercase mb-3">What you get</p>
          <h2 className="font-display text-4xl font-bold text-white max-w-md">
            More than a name and a LinkedIn link.
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {features.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="group"
              >
                <div className="w-10 h-10 rounded-xl bg-brand-400/10 border border-brand-400/20 flex items-center justify-center mb-5 group-hover:bg-brand-400/15 transition-colors">
                  <Icon className="w-5 h-5 text-brand-400" />
                </div>
                <h3 className="font-display text-base font-semibold text-white mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  {feature.description}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
