/**
 * The ONLY LLM call in the product: optionally rewrite the template draft in a
 * warmer voice. Messages API called directly (no agent framework). The result
 * must pass guardAiDraft(), otherwise the template draft is used.
 */
import { guardAiDraft, type GuardOptions } from "./draft";

export const DEFAULT_MODEL = "claude-haiku-5-5";

const SYSTEM = `You rewrite a daily site-progress message from an interior design studio so it reads warm and clear for a homeowner.
Rules:
- Use ONLY the facts, dates and numbers present in the draft. Copy every date exactly as written.
- Do NOT add dates, deadlines, promises, causes, links, phone numbers or new facts.
- Plain, friendly English with short sentences. At most 90 words. Keep the bullet points ("•").
- Output only the final message text, nothing else.`;

export function aiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim());
}

export interface RewriteResult {
  message: string;
  source: "ai" | "template";
  warning?: string;
}

export async function rewriteDraft(
  template: string,
  guard: GuardOptions,
  opts: { apiKey: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<RewriteResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const fallback = (why: string): RewriteResult => ({
    message: template,
    source: "template",
    warning: `AI rewrite was not used because ${why}. Showing the standard draft instead.`,
  });
  try {
    const res = await doFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: opts.model || DEFAULT_MODEL,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: "user", content: `Draft to rewrite:\n\n${template}` }],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    if (!res.ok) return fallback(`the AI service returned an error (${res.status})`);
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
    const checked = guardAiDraft(text, guard);
    if (!checked.ok) return fallback(checked.reason);
    return { message: checked.text, source: "ai" };
  } catch {
    return fallback("the AI service could not be reached");
  }
}
