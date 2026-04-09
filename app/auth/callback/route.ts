import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    const cookieStore = cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(
            cookiesToSet: Array<{
              name: string;
              value: string;
              options: CookieOptions;
            }>
          ) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );

      await supabase.auth.exchangeCodeForSession(code);
  }

  const next = requestUrl.searchParams.get("next") || "/dashboard";
  const destination = next.startsWith("/") ? next : "/dashboard";

  // If this page loaded inside a popup (opened by login-form), notify the opener
  // and close — the opener will do the final navigation, keeping its history clean.
  // If there is no opener (e.g. popup was blocked and we fell back to a full redirect),
  // just replace the current entry with the destination as before.
  return new NextResponse(
    `<!doctype html><html><head></head><body><script>
if (window.opener && window.opener !== window) {
  window.opener.postMessage({ type: "oauth-complete" }, window.location.origin);
  setTimeout(() => window.close(), 100);
} else {
  window.location.replace(${JSON.stringify(destination)});
}
</script></body></html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  );
}