import { readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { interactionFromPayload } from "./classifier.js";
import { exportReport } from "./export-report.js";
import { injectObserverSdk } from "./html-transform.js";
import { maybeJudgeEvent } from "./judge.js";
import { canonicalOrigin, SessionStore } from "./session-store.js";

const DEFAULT_PORT = 4765;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * @param {{ store?: SessionStore }} [options]
 */
export function createApp(options = {}) {
  const app = express();
  const store = options.store ?? new SessionStore();

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true, name: "fathom" });
  });

  app.get("/chrome", (request, response) => {
    const origin = typeof request.query.origin === "string" ? request.query.origin : "";
    const target = typeof request.query.url === "string" ? request.query.url : origin;
    response.type("html").send(chromeHtml(origin, target));
  });

  app.get("/observer-sdk.js", async (_request, response, next) => {
    try {
      response.type("application/javascript").send(await readObserverSdk());
    } catch (error) {
      next(error);
    }
  });

  app.get("/proxy", async (request, response, next) => {
    try {
      const target = requireOrigin(request.query.url);
      const upstream = await fetch(target, { redirect: "manual" });
      const contentType = upstream.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        const html = await upstream.text();
        response.status(upstream.status).type("html").send(injectObserverSdk(html));
        return;
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      response.status(upstream.status);
      if (contentType) response.type(contentType);
      response.send(body);
    } catch (error) {
      next(error);
    }
  });

  app.get("/chrome-client.js", async (_request, response, next) => {
    try {
      response.type("application/javascript").send(await readAsset("chrome-client.js", path.join("src", "chrome-client.js")));
    } catch (error) {
      next(error);
    }
  });

  app.get("/chrome.css", async (_request, response, next) => {
    try {
      response.type("text/css").send(await readAsset("chrome.css", path.join("src", "chrome.css")));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions", async (request, response, next) => {
    try {
      const url = String(request.body?.url ?? "");
      const session = await store.getOrCreate(url);
      if (request.body?.title || request.body?.url) {
        await store.upsertPage(session.origin, {
          url: request.body.url ?? session.origin,
          title: request.body.title ?? "",
          firstVisitedAt: new Date().toISOString(),
          discoveredVia: request.body.discoveredVia
        });
      }
      const refreshed = await store.read(session.origin);
      response.status(201).json({
        ok: true,
        session: refreshed,
        chromeUrl: `/chrome?origin=${encodeURIComponent(session.origin)}&url=${encodeURIComponent(url)}`
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/session", async (request, response, next) => {
    try {
      const origin = requireOrigin(request.query.origin);
      const session = await store.getOrCreate(origin);
      response.json({ ok: true, session });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/interactions", async (request, response, next) => {
    try {
      const fastEvent = interactionFromPayload(request.body ?? {});
      const event = await maybeJudgeEvent(fastEvent, { enabled: process.env.FATHOM_JUDGE === "1" });
      const origin = canonicalOrigin(event.pageUrl || request.body?.origin || request.body?.before?.url || request.body?.after?.url);
      const stored = await store.appendInteraction(origin, event);
      if (event.after.url) {
        await store.upsertPage(origin, {
          url: event.after.url,
          title: request.body?.title ?? "",
          firstVisitedAt: new Date().toISOString(),
          discoveredVia: stored.id
        });
      }
      response.status(201).json({ ok: true, event: stored });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/notifications/:eventId/approve", async (request, response, next) => {
    try {
      const origin = requireOrigin(request.body?.origin ?? request.query.origin);
      const result = await store.updateNotification(origin, request.params.eventId, "approved", { text: request.body?.text });
      response.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/notifications/:eventId/dismiss", async (request, response, next) => {
    try {
      const origin = requireOrigin(request.body?.origin ?? request.query.origin);
      const result = await store.updateNotification(origin, request.params.eventId, "dismissed");
      response.json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/poll", async (request, response, next) => {
    try {
      const origin = requireOrigin(request.query.origin);
      const items = await store.drainQueue(origin);
      response.json({ ok: true, origin: canonicalOrigin(origin), queue: items, empty: items.length === 0 });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/notify", async (request, response, next) => {
    try {
      const origin = requireOrigin(request.query.origin);
      const session = await store.getOrCreate(origin);
      const notifications = session.timeline
        .filter((event) => event.notification?.status === "open")
        .map((event) => ({ sourceEventId: event.id, ...event.notification, event }));
      response.json({ ok: true, origin: session.origin, notifications, empty: notifications.length === 0 });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/comments", async (request, response, next) => {
    try {
      const origin = requireOrigin(request.body?.origin);
      const text = String(request.body?.text ?? "").trim();
      if (!text) {
        response.status(400).json({ ok: false, error: "comment text is required" });
        return;
      }
      const item = await store.enqueue(origin, {
        text,
        sourceEventId: request.body?.sourceEventId ?? null
      });
      response.status(201).json({ ok: true, item });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/export", async (request, response, next) => {
    try {
      const origin = requireOrigin(request.body?.origin ?? request.query.origin);
      const session = await store.getOrCreate(origin);
      const report = await exportReport(session, request.body?.dir ? { dir: String(request.body.dir) } : {});
      response.json({ ok: true, origin: session.origin, report });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/end", async (request, response, next) => {
    try {
      const origin = requireOrigin(request.body?.origin ?? request.query.origin);
      const session = await store.getOrCreate(origin);
      response.json({ ok: true, origin: session.origin, ended: true });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    const message = error instanceof Error ? error.message : "unknown error";
    response.status(400).json({ ok: false, error: message });
  });

  return app;
}

function chromeHtml(origin, target) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fathom</title>
  <link rel="stylesheet" href="/chrome.css">
</head>
<body data-origin="${escapeHtml(origin)}">
  <main class="shell">
    <iframe class="app-frame" src="/proxy?url=${encodeURIComponent(target)}" title="App under review"></iframe>
    <aside class="panel">
      <header class="panel-header"><strong>Fathom</strong><span data-role="status"></span></header>
      <nav class="tabs"><button data-tab="notifications">Notifications</button><button data-tab="timeline">Timeline</button><button data-tab="queue">Queue</button></nav>
      <section data-view="notifications"></section>
      <section data-view="timeline" hidden></section>
      <section data-view="queue" hidden></section>
    </aside>
  </main>
  <script type="module" src="/chrome-client.js"></script>
</body>
</html>`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function requireOrigin(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("origin is required");
  }
  return value;
}

/** @param {string} value */
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * @param {string} distName
 * @param {string} sourceRelativePath
 */
async function readAsset(distName, sourceRelativePath) {
  try {
    return await readFile(path.join(ROOT_DIR, "dist", distName), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return readFile(path.join(ROOT_DIR, sourceRelativePath), "utf8");
    }
    throw error;
  }
}

async function readObserverSdk() {
  return readAsset("observer-sdk.js", path.join("src", "browser", "observer-sdk.js"));
}

/**
 * @param {{ port?: number, store?: SessionStore, idleTimeoutMs?: number }} [options]
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export async function startServer(options = {}) {
  const app = createApp({ store: options.store });
  const port = options.port ?? DEFAULT_PORT;
  const server = createHttpServer(app);
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  let idleTimer = null;

  function clearIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  function armIdleTimer() {
    clearIdleTimer();
    if (idleTimeoutMs <= 0) return;
    idleTimer = setTimeout(() => {
      server.close(() => {});
    }, idleTimeoutMs);
    idleTimer.unref?.();
  }

  server.on("request", armIdleTimer);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(undefined));
  });

  armIdleTimer();

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    port: actualPort,
    close: () =>
      new Promise((resolve, reject) => {
        clearIdleTimer();
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
