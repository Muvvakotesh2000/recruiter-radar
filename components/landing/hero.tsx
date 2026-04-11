"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Star } from "lucide-react";
import { Button } from "@/components/ui/button";

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.25, 0.1, 0.25, 1] } },
};

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
      {/* Mesh background */}
      <div className="absolute inset-0 mesh-bg" />

      {/* Animated orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.15, 0.25, 0.15] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/4 -left-1/4 w-[600px] h-[600px] bg-brand-600 rounded-full blur-[120px]"
        />
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.1, 0.2, 0.1] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute bottom-1/4 -right-1/4 w-[500px] h-[500px] bg-blue-600 rounded-full blur-[120px]"
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.05, 0.12, 0.05] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 4 }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-cyan-600 rounded-full blur-[100px]"
        />
      </div>

      {/* Grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          {/* Pill badge */}
          <motion.div variants={itemVariants} className="flex justify-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border border-brand-500/30 text-sm text-brand-300">
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI-Powered Recruiter Discovery</span>
              <span className="w-px h-3.5 bg-brand-500/40" />
              <span className="text-brand-400 font-medium">Free to start</span>
            </div>
          </motion.div>

          {/* Headline */}
          <motion.h1
            variants={itemVariants}
            className="font-display text-5xl sm:text-6xl lg:text-7xl font-black text-white leading-[1.05] tracking-tight"
          >
            Find the right{" "}
            <span className="relative">
              <span className="gradient-text">recruiter</span>
              <motion.span
                className="absolute -bottom-1 left-0 right-0 h-px bg-gradient-to-r from-transparent via-brand-500 to-transparent"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.8, duration: 0.8 }}
              />
            </span>
            <br />
            for every job.
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            variants={itemVariants}
            className="text-xl sm:text-2xl text-zinc-400 max-w-3xl mx-auto leading-relaxed font-light"
          >
            Paste a job URL. Our AI searches LinkedIn, Apollo, and Hunter to find the{" "}
            <span className="text-white font-medium">exact recruiter</span> handling your role — complete with contact info and a personalized outreach message.
          </motion.p>

          {/* CTAs */}
          <motion.div
            variants={itemVariants}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2"
          >
            <Link href="/signup">
              <Button variant="gradient" size="xl" className="gap-2 shadow-glow-lg text-base">
                <Sparkles className="w-5 h-5" />
                Start finding recruiters
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="glass" size="xl" className="text-base gap-2">
                Sign in
              </Button>
            </Link>
          </motion.div>

          {/* Social proof */}
          <motion.div
            variants={itemVariants}
            className="flex items-center justify-center gap-4 text-sm text-muted-foreground pt-4"
          >
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              ))}
            </div>
            <span>Trusted by 1,000+ job seekers</span>
          </motion.div>
        </motion.div>

        {/* Hero visual — floating dashboard mockup */}
        <motion.div
          initial={{ opacity: 0, y: 60, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.7, duration: 0.9, ease: [0.25, 0.1, 0.25, 1] }}
          className="mt-20 relative"
        >
          <div className="relative mx-auto max-w-4xl">
            {/* Glow behind mockup */}
            <div className="absolute -inset-4 bg-gradient-to-r from-brand-600/20 via-blue-600/20 to-brand-600/20 rounded-3xl blur-2xl" />

            {/* Mockup card */}
            <div className="relative glass-strong rounded-2xl border border-white/10 p-6 shadow-2xl">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-amber-500/70" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/70" />
                <div className="flex-1 mx-4 h-6 bg-secondary/60 rounded-md" />
              </div>

              {/* Fake recruiter cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { name: "Sarah Mitchell", title: "Sr. Technical Recruiter", conf: "High", email: "s.mitchell@stripe.com" },
                  { name: "James Okonkwo", title: "Talent Acquisition Partner", conf: "High", email: "j.okonkwo@stripe.com" },
                  { name: "Priya Nair", title: "Head of Talent Acquisition", conf: "Medium", email: null },
                ].map((r, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.0 + i * 0.15, duration: 0.4 }}
                    className="glass rounded-xl p-4 border border-border/50"
                  >
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-blue-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                        {r.name.split(" ").map(n => n[0]).join("")}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{r.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{r.title}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.conf === "High" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
                        {r.conf}
                      </span>
                      {r.email ? (
                        <span className="text-xs text-brand-400 font-mono truncate max-w-[100px]">{r.email}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">No email</span>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
