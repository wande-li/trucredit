import OpenAI from "openai";

// P2-8: Fail-fast — refuse to start with empty API key
if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error(
    "DEEPSEEK_API_KEY is required. Please set it in Railway Variables.",
  );
}

export const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
});

interface AiCompleteParams {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object" | "text";
  /** P1-3: Timeout in ms — defaults to 30s, max 120s */
  timeout?: number;
}

const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 120_000;

/**
 * P1-3: AI API call with AbortController timeout.
 * P2-8: Fail-fast — this function is unreachable if API key is missing
 *         (process exits at module load above), but timeout adds safety
 *         in case DeepSeek hangs.
 */
export async function aiComplete(params: AiCompleteParams) {
  const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    return await deepseek.chat.completions.create(
      {
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 2000,
        response_format: params.responseFormat
          ? { type: params.responseFormat }
          : undefined,
      },
      { signal: controller.signal },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
