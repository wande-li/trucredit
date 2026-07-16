import OpenAI from "openai";

export const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || "",
  baseURL: "https://api.deepseek.com",
});

interface AiCompleteParams {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object" | "text";
}

export async function aiComplete(params: AiCompleteParams) {
  return deepseek.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    temperature: params.temperature ?? 0.7,
    max_tokens: params.maxTokens ?? 2000,
    response_format: params.responseFormat
      ? { type: params.responseFormat }
      : undefined,
  });
}
