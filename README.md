# RecruiterRadar

An AI-powered recruiter discovery platform that finds the right hiring contacts for any job opening instantly. Paste a job URL, and RecruiterRadar identifies, analyzes, and surfaces the most relevant recruiters at that company — complete with estimated emails and ready-to-send outreach messages.

## Features

- **AI-Powered Discovery** — Generates targeted search queries and extracts recruiter profiles from real search results
- **Location-First Matching** — Tiered location scoring (exact city → metro → state) prioritizes local recruiters
- **Email Estimation** — Detects company email patterns and estimates recruiter emails
- **Ready-to-Send Messages** — Generates personalized outreach messages tailored to each recruiter
- **Job History** — All past searches saved to your dashboard with full recruiter leads
- **Regenerate & Edit** — Re-run any search with updated details or regenerate outreach messages
- **Real-Time Updates** — Generation progress streamed live via Supabase Realtime

## Tech Stack

- **Framework** — Next.js 14 (App Router)
- **Auth & Database** — Supabase (PostgreSQL + Realtime)
- **AI** — xAI Grok (primary) / OpenAI GPT-4o (fallback)
- **Search** — Serper.dev (Google Search API)
- **Styling** — Tailwind CSS + shadcn/ui
- **Deployment** — Vercel
- **Language** — TypeScript

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/Muvvakotesh2000/recruiter-radar.git
cd recruiter-radar
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env.local
```

Fill in your values:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |
| `XAI_API_KEY` | xAI API key |
| `OPENAI_API_KEY` | OpenAI API key (fallback) |
| `SERPER_API_KEY` | Serper.dev API key for Google Search |
| `NEXT_PUBLIC_APP_URL` | App URL (e.g. `http://localhost:3000`) |

### 4. Set up the database

Run the schema against your Supabase project:

```bash
# Paste contents of supabase/schema.sql into the Supabase SQL editor
```

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How It Works

1. **Submit a job** — Enter company name, job title, location, and job URL
2. **Query generation** — AI generates targeted search queries for that role and company
3. **Search execution** — Queries run against Google Search (via Serper) in parallel
4. **Non-AI extraction** — Structured LinkedIn snippets are parsed directly (no AI cost)
5. **AI fallback** — AI extracts contacts from remaining unstructured results
6. **Scoring & ranking** — Leads scored by location match, title relevance, and confidence
7. **Email estimation** — Company email pattern detected and applied to fill missing emails
8. **Results** — Recruiter cards with name, title, location, email, LinkedIn, and outreach message

## Project Structure

```
app/
├── (auth)/           # Login & signup pages
├── (dashboard)/      # Main dashboard
│   └── dashboard/    # Job list + recruiter results
├── api/
│   └── generate/     # POST/PATCH/DELETE job generation (CORS + Bearer token support)
lib/
├── ai/               # AI providers (xAI, OpenAI) + prompt templates
├── search/           # Search providers (Serper, Brave, Tavily)
├── services/
│   ├── recruiter-extractor.ts   # Non-AI LinkedIn parsing + scoring
│   ├── generation.ts            # Full generation pipeline
│   ├── jobs.ts                  # Job CRUD
│   └── email-detective.ts       # Email pattern detection
```

## Live Demo

[recruiterradar.app](https://www.recruiterradar.app)

## License

MIT
