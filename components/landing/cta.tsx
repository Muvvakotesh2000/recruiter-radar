"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CtaSection() {
  return (
    <section className="py-24 border-t border-border/30">
      <div className="max-w-5xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="flex flex-col md:flex-row md:items-end justify-between gap-8"
        >
          <div>
            <h2 className="font-display text-4xl sm:text-5xl font-black text-white leading-tight mb-4">
              Stop applying<br />
              <span className="text-brand-400">into the void.</span>
            </h2>
            <p className="text-zinc-400 text-lg max-w-sm">
              You already did the hard part — finding the job. Now find the person.
            </p>
          </div>

          <div className="flex flex-col gap-3 md:items-end flex-shrink-0">
            <Link href="/signup">
              <Button className="bg-brand-400 hover:bg-brand-500 text-white border-0 h-12 px-8 text-base gap-2 w-full md:w-auto">
                Get started free
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <p className="text-xs text-zinc-600 md:text-right">No credit card required</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
