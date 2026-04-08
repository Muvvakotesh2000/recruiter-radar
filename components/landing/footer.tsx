import Link from "next/link";
import { Radar } from "lucide-react";

export function LandingFooter() {
  return (
    <footer className="border-t border-border/40 py-12">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center">
              <Radar className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-display text-sm font-bold text-white">RecruiterRadar</span>
          </Link>

          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} RecruiterRadar. Built with Next.js, Supabase, and xAI.
          </p>

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="hover:text-foreground cursor-pointer transition-colors">Privacy</span>
            <span className="hover:text-foreground cursor-pointer transition-colors">Terms</span>
            <Link href="/login" className="hover:text-foreground transition-colors">Sign in</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
