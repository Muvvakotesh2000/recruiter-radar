/**
 * Mock search provider for local development.
 * Returns realistic-looking LinkedIn/Apollo search result snippets
 * so the extraction AI has something to work with.
 */

import type { SearchProvider, SearchResponse } from "../base";

const DELAY_MS = 400;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class MockSearchProvider implements SearchProvider {
  readonly providerName = "mock";

  async search(query: string, _maxResults = 7): Promise<SearchResponse> {
    await sleep(DELAY_MS);

    // Parse company and role hints from the query for realism
    const lower = query.toLowerCase();
    const company = extractHint(lower, ["at ", "\"", " "]) || "TechCorp";
    const isLinkedIn = lower.includes("linkedin");
    const isEmail = lower.includes("email") || lower.includes("@");
    const isApollo = lower.includes("apollo") || lower.includes("rocketreach");

    if (isLinkedIn) {
      return {
        query,
        results: [
          {
            title: `Sarah Mitchell – Senior Technical Recruiter at ${company} | LinkedIn`,
            url: `https://www.linkedin.com/in/sarah-mitchell-sr-recruiter`,
            snippet: `Senior Technical Recruiter at ${company} · San Francisco Bay Area · Recruiting for software engineering, data, and ML roles. Previously at Meta. 500+ connections on LinkedIn. sarah.mitchell@${slugify(company)}.com`,
          },
          {
            title: `James Okonkwo – Talent Acquisition Partner, Engineering | ${company} | LinkedIn`,
            url: `https://www.linkedin.com/in/james-okonkwo-talent`,
            snippet: `Talent Acquisition Partner at ${company} · New York, NY · Specializes in full-stack, backend, and infrastructure hiring across AMER. Open to recruiter outreach. james.okonkwo@${slugify(company)}.com`,
          },
          {
            title: `Priya Nair – Head of Global Talent Acquisition | ${company} | LinkedIn`,
            url: `https://www.linkedin.com/in/priya-nair-talent-head`,
            snippet: `Head of Global Talent Acquisition at ${company} · Bengaluru, India · Building TA teams globally. Oversees technical and non-technical recruiting across APAC and EMEA.`,
          },
          {
            title: `Alex Chen – Engineering Hiring Manager at ${company} | LinkedIn`,
            url: `https://www.linkedin.com/in/alex-chen-eng-manager`,
            snippet: `Engineering Manager at ${company} · Seattle, WA · Leading platform engineering team. Actively hiring senior engineers and tech leads in 2024–2025.`,
          },
        ],
      };
    }

    if (isEmail || isApollo) {
      return {
        query,
        results: [
          {
            title: `Sarah Mitchell – Technical Recruiter at ${company}`,
            url: `https://www.apollo.io/people/Sarah-Mitchell/${slugify(company)}`,
            snippet: `Sarah Mitchell works as a Senior Technical Recruiter at ${company}. Email: s.mitchell@${slugify(company)}.com. Phone: +1 (415) 555-0192. LinkedIn: linkedin.com/in/sarah-mitchell-sr-recruiter`,
          },
          {
            title: `${company} Recruiter Contacts – RocketReach`,
            url: `https://rocketreach.co/search?${slugify(company)}-recruiter`,
            snippet: `Find verified emails for ${company} recruiters. Email format: {first}.{last}@${slugify(company)}.com. Top contacts: James Okonkwo (j.okonkwo@${slugify(company)}.com), Sarah Mitchell (s.mitchell@${slugify(company)}.com).`,
          },
          {
            title: `${company} email format and employee emails – Hunter.io`,
            url: `https://hunter.io/search/${slugify(company)}.com`,
            snippet: `The most common email pattern used at ${company} is {first}.{last}@${slugify(company)}.com (87% confidence). 1,240+ emails found. Most common department: Engineering.`,
          },
        ],
      };
    }

    // Generic fallback
    return {
      query,
      results: [
        {
          title: `${company} Talent Acquisition – Careers`,
          url: `https://www.${slugify(company)}.com/careers`,
          snippet: `Join ${company}. We're hiring for software engineering, data science, and product roles. Our talent team: Sarah Mitchell (sr-recruiter), James Okonkwo (ta-partner). Email: recruiting@${slugify(company)}.com`,
        },
        {
          title: `${company} on LinkedIn – People`,
          url: `https://www.linkedin.com/company/${slugify(company)}/people`,
          snippet: `${company} has 4,200 employees on LinkedIn. Human Resources team: 38 people. Top recruiters: Sarah Mitchell, James Okonkwo, Priya Nair. Location: San Francisco, New York, Austin.`,
        },
      ],
    };
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);
}

function extractHint(s: string, delimiters: string[]): string {
  for (const d of delimiters) {
    const idx = s.indexOf(d);
    if (idx !== -1) {
      const after = s.slice(idx + d.length);
      const word = after.split(/[\s"]/)[0];
      if (word && word.length > 2) return word;
    }
  }
  return "";
}
