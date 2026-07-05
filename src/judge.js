import { scoreNotification } from "./classifier.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_API_URL = "https://api.anthropic.com/v1/messages";

/**
 * @param {{ declaredIntent: string, outcome: string, domSubtreeDiff?: string, networkCalls?: unknown[] }} input
 * @param {{ apiKey?: string, model?: string, fetch?: typeof fetch, apiUrl?: string }} [options]
 * @returns {Promise<{ verdict: "match"|"mismatch"|"partial"|"unclear", reasoning: string, confidence: number }>}
 */
export async function judgeInteraction(input, options = {}) {
  if (!input.declaredIntent) {
    throw new Error("declaredIntent is required for LLM judgment");
  }

  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for LLM judgment");
  }

  const request = options.fetch ?? fetch;
  const response = await request(options.apiUrl ?? DEFAULT_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: options.model ?? DEFAULT_MODEL,
      max_tokens: 300,
      system: "You judge whether a browser interaction matched a declared UI intent. Return only compact JSON.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            instruction: "Return JSON with verdict as match, mismatch, partial, or unclear; short reasoning; confidence 0-1.",
            declaredIntent: input.declaredIntent,
            outcome: input.outcome,
            domSubtreeDiff: input.domSubtreeDiff ?? "",
            networkCalls: input.networkCalls ?? []
          })
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic judge request failed: ${response.status}`);
  }

  const body = await response.json();
  return parseJudgment(extractText(body));
}

/**
 * @param {unknown} body
 */
export function extractText(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.content)) return "";
  return body.content
    .filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/**
 * @param {string} text
 * @returns {{ verdict: "match"|"mismatch"|"partial"|"unclear", reasoning: string, confidence: number }}
 */
export function parseJudgment(text) {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{") ? trimmed : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  const parsed = JSON.parse(jsonText);
  const verdict = ["match", "mismatch", "partial", "unclear"].includes(parsed.verdict) ? parsed.verdict : "unclear";
  const confidence = Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : 0;
  return {
    verdict,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 500) : "",
    confidence
  };
}

/**
 * @param {ReturnType<import("./classifier.js").interactionFromPayload>} event
 * @param {{ apiKey?: string, fetch?: typeof fetch, enabled?: boolean }} [options]
 */
export async function maybeJudgeEvent(event, options = {}) {
  if (!shouldJudge(event, options)) return event;

  const judgment = await judgeInteraction(
    {
      declaredIntent: event.declaredIntent,
      outcome: event.outcome,
      domSubtreeDiff: event.after.domSubtreeDiff,
      networkCalls: event.after.pendingNetworkCalls
    },
    options
  );

  return {
    ...event,
    judgment,
    notification:
      event.notification ??
      scoreNotification({
        declaredIntent: event.declaredIntent,
        outcome: event.outcome,
        judgment,
        elementKind: null
      })
  };
}

function shouldJudge(event, options) {
  if (!event.declaredIntent) return false;
  if (options.enabled === false || process.env.FATHOM_JUDGE === "0") return false;
  if (options.enabled === true) return true;
  return Boolean(options.apiKey ?? process.env.ANTHROPIC_API_KEY);
}
