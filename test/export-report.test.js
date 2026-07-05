import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { exportReport, renderReport } from "../src/export-report.js";

function session() {
  return {
    id: "s1",
    origin: "http://localhost:3000",
    startedAt: "2026-07-05T00:00:00.000Z",
    pages: [{ url: "http://localhost:3000/cart", title: "Cart", firstVisitedAt: "2026-07-05T00:00:00.000Z" }],
    timeline: [{
      id: "event-1",
      timestamp: "2026-07-05T00:00:00.000Z",
      pageUrl: "http://localhost:3000/cart",
      selector: "#checkout",
      elementLabel: "Checkout",
      declaredIntent: "navigates",
      before: { url: "/cart", domHash: "a", screenshot: "", pendingNetworkCalls: [], consoleErrors: [] },
      after: { url: "/cart", domHash: "a", screenshot: "", pendingNetworkCalls: [], consoleErrors: [] },
      outcome: "no_change",
      judgment: null,
      notification: { severity: "high", reason: "declared intent, zero observed effect", status: "open" },
      comments: []
    }],
    queue: [{ id: "q1", sourceEventId: "event-1", text: "Fix checkout", createdAt: "2026-07-05T00:00:00.000Z", sent: false }]
  };
}

test("renderReport creates a portable timeline report", () => {
  const html = renderReport(session());

  assert.match(html, /Fathom Report/);
  assert.match(html, /Checkout/);
  assert.match(html, /Fix checkout/);
});

test("exportReport writes JSON and HTML artifacts", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fathom-report-"));
  const report = await exportReport(session(), { dir });

  assert.match(await readFile(report.jsonPath, "utf8"), /"origin": "http:\/\/localhost:3000"/);
  assert.match(await readFile(report.htmlPath, "utf8"), /Fathom Report/);
});
