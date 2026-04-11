"use client";

import { motion } from "framer-motion";
import { Briefcase, Users, TrendingUp, Mail, CheckCircle } from "lucide-react";

interface MetricsData {
  totalJobs: number;
  completedJobs: number;
  totalLeads: number;
  highConfidenceLeads: number;
  leadsWithEmail: number;
}

interface DashboardMetricsProps {
  metrics: MetricsData;
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.4, ease: "easeOut" },
  }),
};

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  iconBg: string;
  index: number;
}

function StatCard({ icon, label, value, sub, iconBg, index }: StatCardProps) {
  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      className="glass rounded-xl p-5 flex items-center gap-4 border border-border/50 hover:border-border/80 transition-all duration-300 group"
    >
      <div
        className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg} group-hover:scale-110 transition-transform`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold font-display text-foreground">
          {value.toLocaleString()}
        </div>
        <div className="text-sm text-muted-foreground truncate">{label}</div>
        {sub && (
          <div className="text-xs text-muted-foreground/70 mt-0.5">{sub}</div>
        )}
      </div>
    </motion.div>
  );
}

export function DashboardMetrics({ metrics }: DashboardMetricsProps) {
  const completionRate =
    metrics.totalJobs > 0
      ? Math.round((metrics.completedJobs / metrics.totalJobs) * 100)
      : 0;

  const emailRate =
    metrics.totalLeads > 0
      ? Math.round((metrics.leadsWithEmail / metrics.totalLeads) * 100)
      : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <StatCard
        index={0}
        icon={<Briefcase className="w-5 h-5 text-brand-400" />}
        label="Total Jobs"
        value={metrics.totalJobs}
        iconBg="bg-brand-500/15"
      />
      <StatCard
        index={1}
        icon={<CheckCircle className="w-5 h-5 text-emerald-400" />}
        label="Completed"
        value={metrics.completedJobs}
        sub={`${completionRate}% success rate`}
        iconBg="bg-emerald-500/15"
      />
      <StatCard
        index={2}
        icon={<Users className="w-5 h-5 text-blue-400" />}
        label="Total Leads"
        value={metrics.totalLeads}
        iconBg="bg-blue-500/15"
      />
      <StatCard
        index={3}
        icon={<TrendingUp className="w-5 h-5 text-amber-400" />}
        label="High Confidence"
        value={metrics.highConfidenceLeads}
        iconBg="bg-amber-500/15"
      />
      <StatCard
        index={4}
        icon={<Mail className="w-5 h-5 text-cyan-400" />}
        label="With Email"
        value={metrics.leadsWithEmail}
        sub={`${emailRate}% of leads`}
        iconBg="bg-cyan-500/15"
      />
    </div>
  );
}
