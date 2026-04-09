"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LoginSchema, type LoginInput } from "@/lib/validations/job";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/dashboard";
  const [showPassword, setShowPassword] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const supabase = createClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
  });

  async function onSubmit(data: LoginInput) {
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });

    if (error) {
      toast.error("Sign in failed", {
        description: error.message,
      });
      return;
    }

    toast.success("Welcome back!");
    router.push(redirectTo);
    router.refresh();
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${redirectTo}`,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      toast.error("Google sign in failed", { description: error?.message });
      setGoogleLoading(false);
      return;
    }

    // Open OAuth in a popup so Google's pages never enter the main window's history.
    const w = 500, h = 620;
    const left = Math.max(0, Math.round((screen.width - w) / 2));
    const top = Math.max(0, Math.round((screen.height - h) / 2));
    const popup = window.open(
      data.url,
      "google-oauth",
      `width=${w},height=${h},left=${left},top=${top},scrollbars=yes`
    );

    if (!popup) {
      // Popup blocked — fall back to full-page redirect (history will be polluted, but it works)
      window.location.replace(data.url);
      return;
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "oauth-complete") return;
      cleanup();
      // Full page load so server components pick up the new session cookies
      window.location.replace(redirectTo);
    }

    function cleanup() {
      window.removeEventListener("message", onMessage);
      clearInterval(pollClosed);
      setGoogleLoading(false);
      if (!popup?.closed) popup?.close();
    }

    window.addEventListener("message", onMessage);

    // If the user closes the popup without finishing auth
    const pollClosed = setInterval(() => {
      if (popup.closed) cleanup();
    }, 500);
  }

  return (
    <div className="space-y-5">
      {/* Google OAuth */}
      <Button
        type="button"
        variant="outline"
        className="w-full h-11 border-border/60 hover:border-border hover:bg-secondary/60"
        onClick={handleGoogleSignIn}
        loading={googleLoading}
      >
        {!googleLoading && (
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
        )}
        Continue with Google
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <Separator className="w-full" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
        </div>
      </div>

      {/* Email/Password Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            icon={<Mail className="w-4 h-4" />}
            autoComplete="email"
            {...register("email")}
            error={errors.email?.message}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <button
              type="button"
              className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              icon={<Lock className="w-4 h-4" />}
              autoComplete="current-password"
              className="pr-10"
              {...register("password")}
              error={errors.password?.message}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        <Button
          type="submit"
          variant="gradient"
          className="w-full h-11"
          loading={isSubmitting}
        >
          Sign in
        </Button>
      </form>
    </div>
  );
}
