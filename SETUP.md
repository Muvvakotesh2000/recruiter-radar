# RecruiterRadar — Setup & Run Instructions

## Prerequisites

- Node.js 18.17+ (use `node --version` to check)
- npm, pnpm, or yarn
- A [Supabase](https://supabase.com) account (free tier works)
- At least one AI provider API key (or use `AI_PROVIDER=mock` for local testing)

---

## 1. Install dependencies

```bash
cd recruiter-radar
npm install
```

---

## 2. Set up Supabase

### 2a. Create a new Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Note your **Project URL** and **anon/public key** from Settings → API
3. Also note the **service_role key** (keep this secret)

### 2b. Run the database schema

1. In your Supabase dashboard, go to **SQL Editor**
2. Open `supabase/schema.sql` from this project
3. Paste the entire contents and click **Run**
4. This creates all tables, RLS policies, and triggers

### 2c. Enable Google OAuth (optional)

1. Supabase dashboard → Authentication → Providers → Google
2. Enable it and add your Google OAuth client ID and secret
3. Add `http://localhost:3000/auth/callback` to authorized redirect URIs in Google Cloud Console

---

## 3. Configure environment variables

```bash
cp .env.example .env.local
```

Then edit `.env.local` with your values:

```env
# Required
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# AI provider (start with mock for testing)
AI_PROVIDER=mock

# When ready to use real AI:
AI_PROVIDER=xai
XAI_API_KEY=your-xai-api-key

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> **Tip:** Start with `AI_PROVIDER=mock` to test the full UI without needing an API key.

---

## 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 5. Test the full flow

1. Go to `http://localhost:3000`
2. Click **Get started free** → Create an account
3. After signing in, you'll land on the Dashboard
4. Click **Find Recruiters**
5. Fill in: Company Name, Job Title, Location, Job URL
6. Select `Mock (Local)` provider if testing without API keys
7. Click **Find Recruiters** and wait ~3 seconds
8. You'll be redirected to the job detail page with recruiter cards

---

## 6. Enable real web search (free)

The app uses a **two-phase pipeline**: AI generates search queries → search engine executes them → AI extracts contacts from real results.

### Recommended free option — Serper.dev (2,500 free searches, no credit card)

1. Go to [serper.dev](https://serper.dev) and create a free account
2. Copy your API key from the dashboard
3. In `.env.local`:

```env
SEARCH_PROVIDER=serper
SERPER_API_KEY=your-serper-api-key
```

That's it. 2,500 Google searches free — enough for hundreds of recruiter lookups.

### Alternative free options

| Provider | Free quota | Sign up |
|---|---|---|
| **Brave Search** | 2,000/month forever | [brave.com/search/api](https://brave.com/search/api/) |
| **Tavily** | 1,000/month | [app.tavily.com](https://app.tavily.com) |
| **Serper.dev** | 2,500 total (one-time) | [serper.dev](https://serper.dev) |

For Brave (permanent free tier):
```env
SEARCH_PROVIDER=brave
BRAVE_SEARCH_API_KEY=your-brave-key
```

> **Local testing:** Keep `SEARCH_PROVIDER=mock` to skip web search entirely. The mock provider returns realistic fake data so you can develop the full UI without any API key.

---

## 8. Switch AI providers

In `.env.local`, change `AI_PROVIDER` to one of:

| Value | Provider | Key needed |
|-------|----------|------------|
| `xai` | xAI Grok (default) | `XAI_API_KEY` |
| `openai` | OpenAI GPT-4o | `OPENAI_API_KEY` |
| `anthropic` | Anthropic Claude | `ANTHROPIC_API_KEY` |
| `gemini` | Google Gemini | `GEMINI_API_KEY` |
| `mock` | Local mock data | None |

---

## 9. Build for production

```bash
npm run build
npm run start
```

---

## 10. Deploy to Vercel

### One-click deploy

1. Push your code to a GitHub repository
2. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
3. In **Environment Variables**, add all keys from `.env.example`
4. Set `NEXT_PUBLIC_APP_URL` to your Vercel deployment URL
5. Deploy!

### Supabase production settings

In your Supabase dashboard → Authentication → URL Configuration:
- Add your Vercel URL to **Site URL**: `https://your-app.vercel.app`
- Add callback to **Redirect URLs**: `https://your-app.vercel.app/auth/callback`

---

## Architecture Overview

```
recruiter-radar/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Auth pages (login, signup)
│   ├── (dashboard)/              # Protected dashboard pages
│   ├── api/generate/             # AI generation API route
│   └── auth/callback/            # OAuth callback handler
├── components/
│   ├── auth/                     # Login and signup forms
│   ├── dashboard/                # Dashboard UI components
│   ├── landing/                  # Landing page sections
│   ├── shared/                   # Navbar, theme provider
│   └── ui/                       # shadcn/ui components
├── lib/
│   ├── ai/                       # AI provider abstraction
│   │   ├── base.ts               # Interface definitions
│   │   ├── factory.ts            # Provider factory (env-driven)
│   │   ├── prompt.ts             # Prompt template builder
│   │   └── providers/            # xAI, OpenAI, Anthropic, Gemini, Mock
│   ├── supabase/                 # Supabase client helpers
│   ├── services/                 # Business logic (jobs, generation, leads)
│   └── validations/              # Zod schemas
├── types/                        # TypeScript interfaces
└── supabase/
    └── schema.sql                # Full database schema + RLS policies
```

---

## Rate Limiting (Production Recommendation)

For production, add rate limiting to `/api/generate` using Upstash Redis:

```env
UPSTASH_REDIS_REST_URL=your-upstash-url
UPSTASH_REDIS_REST_TOKEN=your-upstash-token
```

Install: `npm install @upstash/ratelimit @upstash/redis`

Add to `app/api/generate/route.ts`:
```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, "1 h"), // 5 requests per hour
});
```

---

## Common Issues

**"NEXT_PUBLIC_SUPABASE_URL is not defined"**  
→ Make sure `.env.local` exists and the dev server was restarted.

**"relation 'public.profiles' does not exist"**  
→ You need to run `supabase/schema.sql` in your Supabase SQL editor first.

**Google OAuth redirect mismatch**  
→ Add `http://localhost:3000/auth/callback` to both Supabase redirect URLs and Google OAuth console.

**AI provider error**  
→ Switch to `AI_PROVIDER=mock` in `.env.local` to test without API keys.

**TypeScript errors on `next-themes`**  
→ Run `npm install` again to ensure all types are installed.
