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

test("maybeJudgeEvent runs by default for declared intent when an API key is available", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalFlag = process.env.FATHOM_JUDGE;
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.FATHOM_JUDGE;
  try {
    const event = {
      declaredIntent: "navigates",
      outcome: "dom_mutation",
      after: { pendingNetworkCalls: [], domSubtreeDiff: "changed" },
      notification: null
    };
    const judged = await maybeJudgeEvent(event, {
      fetch: async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: '{"verdict":"mismatch","reasoning":"Wrong panel changed","confidence":0.8}' }]
          }),
          { status: 200 }
        )
    });

    assert.equal(judged.judgment.verdict, "mismatch");
  } finally {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalFlag === undefined) delete process.env.FATHOM_JUDGE;
    else process.env.FATHOM_JUDGE = originalFlag;
  }
});

test("maybeJudgeEvent respects FATHOM_JUDGE=0 as an opt-out", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalFlag = process.env.FATHOM_JUDGE;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.FATHOM_JUDGE = "0";
  try {
    const event = { declaredIntent: "navigates", outcome: "dom_mutation", after: { pendingNetworkCalls: [] }, notification: null };
    assert.equal(await maybeJudgeEvent(event), event);
  } finally {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalFlag === undefined) delete process.env.FATHOM_JUDGE;
    else process.env.FATHOM_JUDGE = originalFlag;
  }
});
