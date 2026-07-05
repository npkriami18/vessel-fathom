import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "../src/server.js";
import { SessionStore } from "../src/session-store.js";

async function fixtureServer(options = {}) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "fathom-server-"));
  const store = new SessionStore({ stateDir });
  const app = createApp({ store, ...options });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  return {
    store,
    token: await store.getToken(),
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

function authHeaders(fixture) {
  return { "content-type": "application/json", "x-fathom-token": fixture.token };
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

test("health route identifies fathom", async () => {
  const fixture = await fixtureServer();
  try {
    const response = await fetch(`${fixture.baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, name: "fathom" });
  } finally {
    await fixture.close();
  }
});

test("POST /api/sessions creates an origin-keyed session", async () => {
  const fixture = await fixtureServer();
  try {
    const response = await fetch(`${fixture.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://localhost:3000/cart", title: "Cart" })
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.session.origin, "http://localhost:3000");
    assert.equal(body.session.pages[0].url, "http://localhost:3000/cart");
    assert.match(body.chromeUrl, /^\/chrome\?origin=/);
  } finally {
    await fixture.close();
  }
});

test("token route returns the local mutation token", async () => {
  const fixture = await fixtureServer();
  try {
    const response = await fetch(`${fixture.baseUrl}/api/token`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.token, fixture.token);
  } finally {
    await fixture.close();
  }
});

test("state-mutating routes reject requests without the local token", async () => {
  const fixture = await fixtureServer();
  try {
    const response = await fetch(`${fixture.baseUrl}/api/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin: "http://localhost:3000", text: "Fix checkout" })
    });

    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /x-fathom-token/);
  } finally {
    await fixture.close();
  }
});

test("POST poll drains queued comments", async () => {
  const fixture = await fixtureServer();
  try {
    await fixture.store.enqueue("http://localhost:3000", { text: "Fix checkout", sourceEventId: "event-1" });

    const first = await fetch(`${fixture.baseUrl}/api/poll`, {
      method: "POST",
      headers: authHeaders(fixture),
      body: JSON.stringify({ origin: "http://localhost:3000/cart" })
    });
    const second = await fetch(`${fixture.baseUrl}/api/poll`, {
      method: "POST",
      headers: authHeaders(fixture),
      body: JSON.stringify({ origin: "http://localhost:3000" })
    });
    const firstBody = await first.json();
    const secondBody = await second.json();

    assert.equal(firstBody.queue.length, 1);
    assert.equal(firstBody.queue[0].text, "Fix checkout");
    assert.equal(secondBody.empty, true);
  } finally {
    await fixture.close();
  }
});

test("notify returns open timeline notifications", async () => {
  const fixture = await fixtureServer();
  try {
    await fixture.store.appendInteraction("http://localhost:3000", interaction());

    const response = await fetch(`${fixture.baseUrl}/api/notify?origin=${encodeURIComponent("http://localhost:3000")}`);
    const body = await response.json();

    assert.equal(body.notifications.length, 1);
    assert.equal(body.notifications[0].sourceEventId, "event-1");
    assert.equal(body.notifications[0].severity, "high");
  } finally {
    await fixture.close();
  }
});

test("POST /api/interactions classifies and stores SDK events", async () => {
  const fixture = await fixtureServer();
  try {
    const response = await fetch(`${fixture.baseUrl}/api/interactions`, {
      method: "POST",
      headers: authHeaders(fixture),
      body: JSON.stringify({
        selector: "#checkout",
        elementLabel: "Checkout",
        elementKind: "button",
        declaredIntent: "navigates to /confirm",
        before: { url: "http://localhost:3000/cart", domHash: "a", screenshot: "" },
        after: { url: "http://localhost:3000/cart", domHash: "a", screenshot: "" },
        networkCalls: []
      })
    });
    const body = await response.json();
    const session = await fixture.store.read("http://localhost:3000");

    assert.equal(response.status, 201);
    assert.equal(body.event.outcome, "no_change");
    assert.equal(body.event.notification.severity, "high");
    assert.equal(session?.timeline.length, 1);
  } finally {
    await fixture.close();
  }
});

test("judge failures preserve the fast-path interaction", async () => {
  const fixture = await fixtureServer({
    judgeEvent: async () => {
      throw new Error("rate limited");
    }
  });
  try {
    const response = await fetch(`${fixture.baseUrl}/api/interactions`, {
      method: "POST",
      headers: authHeaders(fixture),
      body: JSON.stringify({
        selector: "#checkout",
        elementLabel: "Checkout",
        elementKind: "button",
        declaredIntent: "navigates to /confirm",
        before: { url: "http://localhost:3000/cart", domHash: "a", screenshot: "" },
        after: { url: "http://localhost:3000/cart", domHash: "b", screenshot: "" },
        networkCalls: []
      })
    });
    const body = await response.json();
    const session = await fixture.store.read("http://localhost:3000");

    assert.equal(response.status, 201);
    assert.equal(body.warning, "rate limited");
    assert.equal(body.event.judgment, null);
    assert.equal(session?.timeline.length, 1);
    assert.equal(session?.timeline[0].outcome, "dom_mutation");
  } finally {
    await fixture.close();
  }
});

test("comments can target an unflagged timeline interaction", async () => {
  const fixture = await fixtureServer();
  try {
    await fixture.store.appendInteraction(
      "http://localhost:3000",
      interaction({ id: "plain-event", notification: null, declaredIntent: null, outcome: "dom_mutation" })
    );

    const response = await fetch(`${fixture.baseUrl}/api/comments`, {
      method: "POST",
      headers: authHeaders(fixture),
      body: JSON.stringify({ origin: "http://localhost:3000", text: "This changed the wrong panel", sourceEventId: "plain-event" })
    });
    const body = await response.json();
    const session = await fixture.store.read("http://localhost:3000");

    assert.equal(response.status, 201);
    assert.equal(body.item.sourceEventId, "plain-event");
    assert.equal(session?.queue[0].text, "This changed the wrong panel");
  } finally {
    await fixture.close();
  }
});

test("notification approve queues edited comment text", async () => {
  const fixture = await fixtureServer();
  try {
    await fixture.store.appendInteraction("http://localhost:3000", interaction({ id: "event-approve" }));

    const approve = await fetch(`${fixture.baseUrl}/api/notifications/event-approve/approve`, {
      method: "POST",
      headers: authHeaders(fixture),
      body: JSON.stringify({ origin: "http://localhost:3000", text: "Edited human approval" })
    });
    const notify = await fetch(`${fixture.baseUrl}/api/notify?origin=${encodeURIComponent("http://localhost:3000")}`);
    const poll = await fetch(`${fixture.baseUrl}/api/poll`, {
      method: "POST",
      headers: authHeaders(fixture),
      body: JSON.stringify({ origin: "http://localhost:3000" })
    });
    const queueBody = await poll.json();

    assert.equal(approve.status, 200);
    assert.equal((await notify.json()).empty, true);
    assert.equal(queueBody.queue.length, 1);
    assert.equal(queueBody.queue[0].text, "Edited human approval");
  } finally {
    await fixture.close();
  }
});

test("chrome route and assets are served", async () => {
  const fixture = await fixtureServer();
  try {
    const chrome = await fetch(
      `${fixture.baseUrl}/chrome?origin=${encodeURIComponent("http://localhost:3000")}&url=${encodeURIComponent("http://localhost:3000/cart")}`
    );
    const css = await fetch(`${fixture.baseUrl}/chrome.css`);
    const js = await fetch(`${fixture.baseUrl}/chrome-client.js`);

    assert.match(await chrome.text(), /<aside class="panel">/);
    assert.match(await css.text(), /\.composer/);
    assert.match(await js.text(), /appendCommentComposer/);
  } finally {
    await fixture.close();
  }
});

test("export route writes report files", async () => {
  const fixture = await fixtureServer();
  try {
    await fixture.store.enqueue("http://localhost:3000", { text: "Fix checkout", sourceEventId: null });
    const response = await fetch(`${fixture.baseUrl}/api/export`, {
      method: "POST",
      headers: authHeaders(fixture),
      body: JSON.stringify({ origin: "http://localhost:3000" })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.match(body.report.jsonPath, /\.json$/);
    assert.match(body.report.htmlPath, /\.html$/);
  } finally {
    await fixture.close();
  }
});

test("proxy injects observer SDK into upstream HTML with token", async () => {
  const upstream = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end("<html><head><title>App</title></head><body><button>Go</button></body></html>");
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  assert.equal(typeof upstreamAddress, "object");

  const fixture = await fixtureServer();
  try {
    const target = `http://127.0.0.1:${upstreamAddress.port}/`;
    const response = await fetch(`${fixture.baseUrl}/proxy?url=${encodeURIComponent(target)}`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /data-fathom-sdk="true"/);
    assert.match(html, /\/observer-sdk\.js/);
    assert.match(html, new RegExp(fixture.token));
  } finally {
    await fixture.close();
    await new Promise((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  }
});

test("observer SDK route serves browser module", async () => {
  const fixture = await fixtureServer();
  try {
    const response = await fetch(`${fixture.baseUrl}/observer-sdk.js`);
    const js = await response.text();

    assert.equal(response.status, 200);
    assert.match(js, /installObserver/);
  } finally {
    await fixture.close();
  }
});
