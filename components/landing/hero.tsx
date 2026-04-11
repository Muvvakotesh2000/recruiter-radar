"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
      {/* Subtle background */}
      <div className="absolute inset-0 bg-background" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-brand-400/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto px-6 pt-16 pb-24">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left — copy */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <p className="text-brand-400 text-sm font-medium tracking-wide uppercase mb-4">
              Recruiter discovery
            </p>

            <h1 className="font-display text-5xl lg:text-6xl font-black text-white leading-[1.08] tracking-tight mb-6">
              Find who's hiring.<br />
              <span className="text-brand-400">Reach out directly.</span>
            </h1>

            <p className="text-zinc-400 text-lg leading-relaxed mb-8 max-w-md">
              Paste any job URL. We find the recruiter behind the listing — their LinkedIn, estimated email, and a message ready to send.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <Link href="/signup">
                <Button className="bg-brand-400 hover:bg-brand-500 text-white border-0 h-11 px-6 text-base gap-2">
                  Get started free
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="ghost" className="text-zinc-400 hover:text-white h-11 px-6 text-base">
                  Sign in
                </Button>
              </Link>
            </div>

            <div className="flex flex-col gap-2">
              {[
                "Works with LinkedIn, Greenhouse, Lever, and more",
                "No manual research — results in under 30 seconds",
              ].map((point) => (
                <div key={point} className="flex items-center gap-2 text-sm text-zinc-500">
                  <CheckCircle2 className="w-4 h-4 text-brand-400 flex-shrink-0" />
                  {point}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right — mockup */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
            className="relative"
          >
            <div className="absolute -inset-2 bg-brand-400/10 rounded-3xl blur-2xl" />
            <div className="relative glass-strong rounded-2xl border border-white/8 overflow-hidden">
              {/* Window bar */}
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/5">
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
                <div className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
                <div className="ml-3 flex-1 h-5 bg-white/5 rounded text-xs text-zinc-600 flex items-center px-2">
                  recruiterradar.com/dashboard
                </div>
              </div>

              <div className="p-5 space-y-3">
                {/* Job context */}
                <div className="flex items-center gap-3 pb-3 border-b border-white/5">
                  <div className="w-9 h-9 rounded-lg bg-brand-400/15 border border-brand-400/20 flex items-center justify-center text-xs font-bold text-brand-400">
                    S
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Software Engineer — Stripe</p>
                    <p className="text-xs text-zinc-500">San Francisco, CA · 3 leads found</p>
                  </div>
                </div>

                {/* Recruiter cards */}
                {[
                  { name: "Sarah Mitchell", title: "Sr. Technical Recruiter", conf: "High", confColor: "text-emerald-400 bg-emerald-500/10", email: "s.mitchell@stripe.com" },
                  { name: "James Okonkwo", title: "Talent Acquisition Partner", conf: "High", confColor: "text-emerald-400 bg-emerald-500/10", email: "j.okonkwo@stripe.com" },
                  { name: "Priya Nair", title: "Head of Talent", conf: "Medium", confColor: "text-amber-400 bg-amber-500/10", email: null },
                ].map((r, i) => (
                  <motion.div
                    key={r.name}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.8 + i * 0.12, duration: 0.35 }}
                    className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-white/3 border border-white/5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-brand-400/20 border border-brand-400/20 flex items-center justify-center text-xs font-semibold text-brand-300 flex-shrink-0">
                        {r.name.split(" ").map(n => n[0]).join("")}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">{r.name}</p>
                        <p className="text-xs text-zinc-500 truncate">{r.title}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${r.confColor}`}>
                        {r.conf}
                      </span>
                      {r.email && (
                        <span className="text-xs text-brand-400 font-mono hidden sm:block">
                          {r.email.split("@")[0]}@…
                        </span>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
