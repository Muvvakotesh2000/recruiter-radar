/**
 * Google OAuth callback — uses GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET directly.
 * Flow: Google → here → exchange code for tokens → sign into Supabase via ID token.
 */

import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("state") || "/dashboard";
  const error = searchParams.get("error");

  if (error) {
    console.error("[Google OAuth] Error from Google:", error);
    return NextResponse.redirect(`${origin}/login?error=google_oauth_failed`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || origin;

  if (!clientId || !clientSecret) {
    console.error("[Google OAuth] Missing NEXT_PUBLIC_GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
    return NextResponse.redirect(`${origin}/login?error=config_missing`);
  }

  // Exchange authorization code for Google tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${appUrl}/auth/callback/google`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("[Google OAuth] Token exchange failed:", err);
    return NextResponse.redirect(`${origin}/login?error=token_exchange_failed`);
  }

  const { id_token, access_token } = await tokenRes.json();

  if (!id_token) {
    console.error("[Google OAuth] No id_token in response");
    return NextResponse.redirect(`${origin}/login?error=no_id_token`);
  }

  // Sign into Supabase using the Google ID token
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const { error: supabaseError } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: id_token,
    access_token,
  });

  if (supabaseError) {
    console.error("[Google OAuth] Supabase signInWithIdToken failed:", supabaseError.message);
    return NextResponse.redirect(`${origin}/login?error=supabase_auth_failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
