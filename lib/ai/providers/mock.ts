/**
 * Mock AI provider — used for local development without API keys.
 * Generates realistic queries and extracts from mock search results.
 */

import type {
  AIProvider,
  RecruiterSearchInput,
  RecruiterLeadResponse,
  SearchQueriesResponse,
} from "@/types/ai";
import type { SearchResult } from "@/lib/search/base";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class MockProvider implements AIProvider {
  readonly providerName = "mock";
  readonly modelName = "mock-v2";

  async generateQueries(
    input: RecruiterSearchInput
  ): Promise<SearchQueriesResponse> {
    await sleep(300);
    const { company_name, job_title, location } = input;

    return {
      queries: [
        {
          query: `site:linkedin.com/in "${company_name}" recruiter "${job_title}"`,
          purpose: "Find LinkedIn profiles of recruiters for this role",
          platform: "linkedin",
        },
        {
          query: `site:linkedin.com/in "${company_name}" "talent acquisition" "${location}"`,
          purpose: "Find TA partners at the company in this location",
          platform: "linkedin",
        },
        {
          query: `"${company_name}" technical recruiter email site:apollo.io OR site:rocketreach.co`,
          purpose: "Find recruiter emails via contact databases",
          platform: "google",
        },
        {
          query: `"${company_name}" recruiter "@${company_name.toLowerCase().replace(/\s+/g, "")}.com"`,
          purpose: "Direct email discovery via Google",
          platform: "google",
        },
        {
          query: `"${company_name}" talent acquisition hiring manager "${job_title}" linkedin`,
          purpose: "Find hiring managers for this specific role",
          platform: "google",
        },
        {
          query: `${company_name} email format site:hunter.io OR site:clearbit.com`,
          purpose: "Determine company email pattern",
          platform: "google",
        },
      ],
    };
  }

  async extractContacts(
    input: RecruiterSearchInput,
    searchResults: SearchResult[]
  ): Promise<RecruiterLeadResponse> {
    await sleep(800);

    const { company_name, job_title, job_url, location } = input;
    const domain =
      company_name.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";

    // Extract any names and emails from real search results if provided
    const extractedNames: string[] = [];
    for (const r of searchResults) {
      const nameMatch = r.title.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
      if (nameMatch) extractedNames.push(nameMatch[1]);
      const emailMatch = r.snippet.match(/[\w.-]+@[\w.-]+\.com/);
      if (emailMatch) extractedNames.push(emailMatch[0]); // crude but captures
    }

    return {
      company_name,
      job_title,
      job_url,
      job_location: location,
      email_pattern: `{first}.{last}@${domain}`,
      hiring_team_notes: `The ${company_name} talent acquisition team is organized by function. Technical recruiting is handled by a dedicated TA pod. Recruiters typically respond to LinkedIn InMail within 3-5 business days. Company email format: {first}.{last}@${domain}`,
      recruiters: [
        {
          full_name: "Sarah Mitchell",
          job_title: "Senior Technical Recruiter",
          linkedin_url:
            "https://www.linkedin.com/in/sarah-mitchell-sr-recruiter",
          email: `s.mitchell@${domain}`,
          email_type: "estimated" as const,
          confidence_level: "High" as const,
          source: `LinkedIn search result: "Senior Technical Recruiter at ${company_name} · San Francisco Bay Area"`,
          outreach_message: `Hi Sarah,\n\nI came across the ${job_title} opening at ${company_name} and I'm very interested. My background aligns closely with the role — I'd love to connect and share more.\n\nWould you be open to a brief call this week?\n\nBest,\n[Your Name]`,
        },
        {
          full_name: "James Okonkwo",
          job_title: "Talent Acquisition Partner, Engineering",
          linkedin_url: "https://www.linkedin.com/in/james-okonkwo-talent",
          email: `j.okonkwo@${domain}`,
          email_type: "estimated" as const,
          confidence_level: "High" as const,
          source: `Apollo.io: "Talent Acquisition Partner at ${company_name}, engineering hiring focus"`,
          outreach_message: `Hi James,\n\nI noticed you handle engineering recruiting at ${company_name}. I'm actively exploring the ${job_title} role and believe I'd be a strong fit. Happy to share my resume directly if helpful.\n\nThanks,\n[Your Name]`,
        },
        {
          full_name: "Priya Nair",
          job_title: "Head of Talent Acquisition",
          linkedin_url: "https://www.linkedin.com/in/priya-nair-talent-head",
          email: null,
          email_type: "unknown" as const,
          confidence_level: "Medium" as const,
          source: `LinkedIn company people page: "${company_name}" HR leadership`,
          outreach_message: `Hi Priya,\n\nI'm reaching out regarding the ${job_title} position at ${company_name} in ${location}. I'd love to learn more about the team and discuss how my experience could contribute.\n\nThank you,\n[Your Name]`,
        },
        {
          full_name: "Alex Chen",
          job_title: "Engineering Manager",
          linkedin_url: "https://www.linkedin.com/in/alex-chen-eng-manager",
          email: `a.chen@${domain}`,
          email_type: "estimated" as const,
          confidence_level: "Medium" as const,
          source: `LinkedIn: "Engineering Manager at ${company_name} · actively hiring in 2024–2025"`,
          outreach_message: `Hi Alex,\n\nI'm interested in the ${job_title} opportunity at ${company_name} and see that you lead the engineering team. I'd welcome the chance to discuss the technical challenges your team is tackling.\n\nBest regards,\n[Your Name]`,
        },
      ],
    };
  }

  /** Legacy fallback — not used in the new pipeline */
  async generateRecruiterLeads(
    input: RecruiterSearchInput
  ): Promise<RecruiterLeadResponse> {
    return this.extractContacts(input, []);
  }
}
