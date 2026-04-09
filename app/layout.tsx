import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { ThemeProvider } from "@/components/shared/theme-provider";
import { Toaster } from "sonner";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "RecruiterRadar — AI-Powered Recruiter Discovery",
    template: "%s | RecruiterRadar",
  },
  description:
    "Find the right recruiters for any job opening instantly. AI-powered recruiter discovery that identifies, analyzes, and connects you with hiring decision-makers.",
  keywords: [
    "recruiter finder",
    "job search",
    "talent acquisition",
    "hiring manager",
    "recruiter outreach",
    "AI recruiting",
  ],
  authors: [{ name: "RecruiterRadar" }],
  openGraph: {
    type: "website",
    locale: "en_US",
    title: "RecruiterRadar — AI-Powered Recruiter Discovery",
    description:
      "Find the right recruiters for any job opening instantly.",
    siteName: "RecruiterRadar",
  },
  twitter: {
    card: "summary_large_image",
    title: "RecruiterRadar — AI-Powered Recruiter Discovery",
    description: "Find the right recruiters for any job opening instantly.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable}`}
    >
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-2P2G7P4P6S"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-2P2G7P4P6S');
          `}
        </Script>
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster
            position="bottom-right"
            richColors
            theme="dark"
            toastOptions={{
              style: {
                background: "hsl(240, 8%, 9%)",
                border: "1px solid hsl(240, 5%, 16%)",
                color: "hsl(0, 0%, 95%)",
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
