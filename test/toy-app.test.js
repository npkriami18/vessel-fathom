import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../src/server.js";
import { hashString } from "../src/browser/observer-sdk.js";
import { SessionStore } from "../src/session-store.js";

async function fixtureServer() {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "fathom-toy-"));
  const store = new SessionStore({ stateDir });
  const server = createServer(createApp({ store }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  return {
    store,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

test("toy app broken button produces high no_change notification", async () => {
  const fixture = await fixtureServer();
  try {
    const html = await readFile(path.join("test", "fixtures", "toy-app", "index.html"), "utf8");
    const domHash = hashString(html);
    const response = await fetch(`${fixture.baseUrl}/api/interactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selector: "#broken-save",
        elementLabel: "Save cart",
        elementKind: "button",
        declaredIntent: "shows saved confirmation",
        before: { url: "http://toy.local/cart", domHash, screenshot: "" },
        after: { url: "http://toy.local/cart", domHash, screenshot: "" },
        networkCalls: []
      })
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.event.outcome, "no_change");
    assert.equal(body.event.notification.severity, "high");
  } finally {
    await fixture.close();
  }
});

test("toy app checkout navigation classifies as navigation", async () => {
  const fixture = await fixtureServer();
  try {
    const beforeHtml = await readFile(path.join("test", "fixtures", "toy-app", "index.html"), "utf8");
    const afterHtml = await readFile(path.join("test", "fixtures", "toy-app", "confirm.html"), "utf8");
    const response = await fetch(`${fixture.baseUrl}/api/interactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selector: "#checkout",
        elementLabel: "Checkout",
        elementKind: "button",
        declaredIntent: "navigates to /confirm and clears cart badge",
        before: { url: "http://toy.local/cart", domHash: hashString(beforeHtml), screenshot: "" },
        after: { url: "http://toy.local/confirm", domHash: hashString(afterHtml), screenshot: "" },
        networkCalls: []
      })
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.event.outcome, "combination");
    assert.equal(body.event.notification, null);
  } finally {
    await fixture.close();
  }
});
