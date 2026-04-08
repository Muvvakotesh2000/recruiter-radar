import type { AIProvider } from "@/types/ai";
import { OpenAIProvider } from "./providers/openai";

/**
 * Returns the OpenAI provider. Only OpenAI is supported.
 */
export async function getAIProvider(_override?: string): Promise<AIProvider> {
  return new OpenAIProvider();
}
