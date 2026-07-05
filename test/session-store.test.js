import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalOrigin, sessionIdForOrigin, SessionStore } from "../src/session-store.js";

async function tempStore() {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "fathom-store-"));
  return new SessionStore({ stateDir });
}

function interaction(overrides = {}) {
  return {
    id: "event-1",
    timestamp: "2026-07-05T00:00:00.000Z",
    pageUrl: "http://localhost:3000/cart",
    selector: "#checkout",
    elementLabel: "Checkout",
    declaredIntent: "navigates to /confirm",
    before: { url: "/cart", domHash: "a", screenshot: "", pendingNetworkCalls: [], consoleErrors: [] },
    after: { url: "/cart", domHash: "a", screenshot: "", pendingNetworkCalls: [], consoleErrors: [] },
    outcome: "no_change",
    judgment: null,
    notification: { severity: "high", reason: "declared intent, zero observed effect", status: "open" },
    comments: [],
    ...overrides
  };
}

test("canonicalOrigin normalizes URLs to app origin", () => {
  assert.equal(canonicalOrigin("http://localhost:3000/cart?x=1"), "http://localhost:3000");
  assert.equal(canonicalOrigin("localhost:5173/path"), "http://localhost:5173");
  assert.equal(canonicalOrigin("https://example.com/a"), "https://example.com");
});

test("session ids are stable per canonical origin", () => {
  assert.equal(sessionIdForOrigin("http://localhost:3000/a"), sessionIdForOrigin("http://localhost:3000/b"));
  assert.notEqual(sessionIdForOrigin("http://localhost:3000"), sessionIdForOrigin("http://localhost:3001"));
});

test("getOrCreate persists a session keyed by origin", async () => {
  const store = await tempStore();
  const created = await store.getOrCreate("http://localhost:3000/cart");
  const loaded = await store.read("http://localhost:3000/checkout");

  assert.equal(created.origin, "http://localhost:3000");
  assert.deepEqual(loaded, created);
});

test("upsertPage records discovered pages without duplicating URLs", async () => {
  const store = await tempStore();
  await store.upsertPage("http://localhost:3000", {
    url: "http://localhost:3000/cart",
    title: "Cart",
    firstVisitedAt: "2026-07-05T00:00:00.000Z"
  });
  const session = await store.upsertPage("http://localhost:3000", {
    url: "http://localhost:3000/cart",
    title: "Shopping Cart",
    firstVisitedAt: "2026-07-05T00:00:00.000Z"
  });

  assert.equal(session.pages.length, 1);
  assert.equal(session.pages[0].title, "Shopping Cart");
});

test("appendInteraction stores timeline entries with generated metadata", async () => {
  const store = await tempStore();
  const event = await store.appendInteraction(
    "http://localhost:3000",
    interaction({ id: undefined, timestamp: undefined, comments: undefined })
  );
  const session = await store.read("http://localhost:3000");

  assert.ok(event.id);
  assert.ok(event.timestamp);
  assert.equal(session?.timeline.length, 1);
  assert.equal(session?.timeline[0].selector, "#checkout");
});

test("updateNotification approves a notification and queues a comment", async () => {
  const store = await tempStore();
  await store.appendInteraction("http://localhost:3000", interaction());

  const result = await store.updateNotification("http://localhost:3000", "event-1", "approved");

  assert.equal(result.queueItem?.sourceEventId, "event-1");
  assert.equal(result.session.timeline[0].notification?.status, "approved");
  assert.equal(result.session.timeline[0].comments.length, 1);
  assert.match(result.session.queue[0].text, /Expected navigates to \/confirm, but observed no_change\./);
});

test("updateNotification dismisses without queueing", async () => {
  const store = await tempStore();
  await store.appendInteraction("http://localhost:3000", interaction());

  const result = await store.updateNotification("http://localhost:3000", "event-1", "dismissed");

  assert.equal(result.queueItem, null);
  assert.equal(result.session.timeline[0].notification?.status, "dismissed");
  assert.equal(result.session.queue.length, 0);
});

test("drainQueue returns unsent items once and marks them sent", async () => {
  const store = await tempStore();
  await store.enqueue("http://localhost:3000", { text: "Fix checkout", sourceEventId: "event-1" });

  const first = await store.drainQueue("http://localhost:3000");
  const second = await store.drainQueue("http://localhost:3000");
  const session = await store.read("http://localhost:3000");

  assert.equal(first.length, 1);
  assert.equal(first[0].sent, false);
  assert.equal(second.length, 0);
  assert.equal(session?.queue[0].sent, true);
});

test("concurrent appendInteraction calls for one origin are serialized", async () => {
  const store = await tempStore();
  const events = Array.from({ length: 12 }, (_, index) => interaction({ id: `event-${index}`, selector: `#button-${index}` }));

  await Promise.all(events.map((event) => store.appendInteraction("http://localhost:3000", event)));
  const session = await store.read("http://localhost:3000");

  assert.equal(session?.timeline.length, events.length);
  assert.deepEqual(new Set(session?.timeline.map((event) => event.id)), new Set(events.map((event) => event.id)));
});
