import { classifierPrompt, generationPrompt, type SupportChunk, type SupportInput } from "./support-gate";

type Message = { role: "system" | "user"; content: string };
async function completion(messages: Message[], classification: boolean) {
  if (!process.env.GROQ_API_KEY) throw new Error("Support model is not configured");
  // The requested llama-3.1-8b-instant is absent from Groq's live model catalog.
  // Keep the model configurable without silently retrying another paid provider.
  const model = process.env.SUPPORT_GROQ_MODEL || "openai/gpt-oss-20b";
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(classification ? 8000 : 15000),
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0,
      max_completion_tokens: classification ? 256 : 768,
      ...(model.startsWith("openai/gpt-oss-") ? { reasoning_effort: "low", reasoning_format: "hidden" } : {}),
      ...(classification ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  // No automatic retries: failed requests must not multiply inference costs.
  if (!response.ok) throw new Error("Support model temporarily unavailable");
  const result = await response.json();
  const choice = result.choices?.[0];
  if (choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string" || !choice.message.content.trim()) throw new Error("Incomplete support model response");
  return choice.message.content as string;
}
export function classifySupport(question: string) {
  return completion([{ role: "system", content: classifierPrompt }, { role: "user", content: JSON.stringify({ question }) }], true);
}
export function generateSupport(input: SupportInput, chunks: SupportChunk[]) {
  // History is context, never an instruction or a replacement for evidence.
  return completion([{ role: "system", content: generationPrompt }, { role: "user", content: JSON.stringify({ question: input.question, history: input.history, documentation: chunks }) }], false);
}
