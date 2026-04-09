import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign In",
};

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");
  return (
    <div className="min-h-screen mesh-bg flex items-center justify-center p-4">
      {/* Background orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2.5 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-lg group-hover:shadow-violet-500/25 transition-shadow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <circle cx="12" cy="12" r="7" strokeDasharray="2 3"/>
                <circle cx="12" cy="12" r="11" strokeDasharray="1 4"/>
              </svg>
            </div>
            <span className="font-display text-xl font-bold text-white">RecruiterRadar</span>
          </Link>
          <p className="mt-4 text-muted-foreground text-sm">
            Sign in to your account to continue
          </p>
        </div>

        {/* Form Card */}
        <div className="glass rounded-2xl p-8 shadow-card">
          <Suspense>
            <LoginForm />
          </Suspense>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link
                href="/signup"
                className="text-violet-400 hover:text-violet-300 font-medium transition-colors"
              >
                Create one free
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing, you agree to our{" "}
          <span className="text-violet-400 cursor-pointer hover:text-violet-300">Terms of Service</span>{" "}
          and{" "}
          <span className="text-violet-400 cursor-pointer hover:text-violet-300">Privacy Policy</span>.
        </p>
      </div>
    </div>
  );
}
