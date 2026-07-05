import assert from "node:assert/strict";
import test from "node:test";

import { extractText, judgeInteraction, maybeJudgeEvent, parseJudgment } from "../src/judge.js";

test("extractText joins Anthropic text content parts", () => {
  assert.equal(
    extractText({
      content: [
        { type: "text", text: "A" },
        { type: "text", text: "B" }
      ]
    }),
    "A\nB"
  );
});

test("parseJudgment normalizes model JSON", () => {
  const judgment = parseJudgment('{"verdict":"mismatch","reasoning":"Button did nothing","confidence":1.5}');

  assert.equal(judgment.verdict, "mismatch");
  assert.equal(judgment.reasoning, "Button did nothing");
  assert.equal(judgment.confidence, 1);
});

test("judgeInteraction calls Anthropic messages API with required model", async () => {
  const calls = [];
  const judgment = await judgeInteraction(
    {
      declaredIntent: "navigates to /confirm",
      outcome: "no_change",
      domSubtreeDiff: "",
      networkCalls: []
    },
    {
      apiKey: "test-key",
      fetch: async (url, options) => {
        calls.push({ url, options });
        return new Response(
          JSON.stringify({ content: [{ type: "text", text: '{"verdict":"mismatch","reasoning":"No effect","confidence":0.9}' }] }),
          { status: 200 }
        );
      }
    }
  );

  const requestBody = JSON.parse(calls[0].options.body);
  assert.equal(requestBody.model, "claude-sonnet-4-6");
  assert.equal(calls[0].options.headers["x-api-key"], "test-key");
  assert.equal(judgment.verdict, "mismatch");
});

test("maybeJudgeEvent leaves fast-path event untouched when disabled", async () => {
  const event = { declaredIntent: "navigates", outcome: "no_change", after: { pendingNetworkCalls: [] }, notification: null };
  assert.equal(await maybeJudgeEvent(event, { enabled: false }), event);
});

test("maybeJudgeEvent attaches mismatch notification from judgment", async () => {
  const event = {
    declaredIntent: "navigates",
    outcome: "dom_mutation",
    after: { pendingNetworkCalls: [], domSubtreeDiff: "changed" },
    notification: null
  };
  const judged = await maybeJudgeEvent(event, {
    enabled: true,
    apiKey: "test-key",
    fetch: async () =>
      new Response(
        JSON.stringify({ content: [{ type: "text", text: '{"verdict":"mismatch","reasoning":"Wrong panel changed","confidence":0.8}' }] }),
        { status: 200 }
      )
  });

  assert.equal(judged.judgment.verdict, "mismatch");
  assert.equal(judged.notification.severity, "likely");
});
