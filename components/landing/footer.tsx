import Link from "next/link";
import { Radar } from "lucide-react";

export function LandingFooter() {
  return (
    <footer className="border-t border-border/30 py-10">
      <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-brand-400 flex items-center justify-center">
            <Radar className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-display text-sm font-bold text-white">RecruiterRadar</span>
        </Link>

        <p className="text-xs text-zinc-600">
          © {new Date().getFullYear()} RecruiterRadar
        </p>

        <div className="flex items-center gap-5 text-xs text-zinc-600">
          <span className="hover:text-zinc-400 cursor-pointer transition-colors">Privacy</span>
          <span className="hover:text-zinc-400 cursor-pointer transition-colors">Terms</span>
          <Link href="/login" className="hover:text-zinc-400 transition-colors">Sign in</Link>
        </div>
      </div>
    </footer>
  );
}
