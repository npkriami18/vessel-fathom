import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { canonicalOrigin } from "./session-store.js";

const DEFAULT_REPORT_DIR = path.join(os.homedir(), ".fathom", "reports");

/**
 * @param {import("./session-store.js").Session} session
 * @param {{ dir?: string }} [options]
 * @returns {Promise<{ jsonPath: string, htmlPath: string }>}
 */
export async function exportReport(session, options = {}) {
  const dir = options.dir ?? DEFAULT_REPORT_DIR;
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const safeOrigin = canonicalOrigin(session.origin).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const base = `${safeOrigin}-${stamp}`;
  const jsonPath = path.join(dir, `${base}.json`);
  const htmlPath = path.join(dir, `${base}.html`);

  await writeFile(jsonPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  await writeFile(htmlPath, renderReport(session), "utf8");

  return { jsonPath, htmlPath };
}

/** @param {import("./session-store.js").Session} session */
export function renderReport(session) {
  const notifications = session.timeline.filter((event) => event.notification);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fathom Report - ${escapeHtml(session.origin)}</title>
  <style>${reportCss()}</style>
</head>
<body>
  <header><h1>Fathom Report</h1><p>${escapeHtml(session.origin)}</p></header>
  <main>
    <section><h2>Summary</h2><dl><div><dt>Pages</dt><dd>${session.pages.length}</dd></div><div><dt>Interactions</dt><dd>${session.timeline.length}</dd></div><div><dt>Notifications</dt><dd>${notifications.length}</dd></div><div><dt>Queue items</dt><dd>${session.queue.length}</dd></div></dl></section>
    <section><h2>Timeline</h2>${session.timeline.map(renderEvent).join("") || "<p>No interactions recorded.</p>"}</section>
    <section><h2>Queue</h2>${session.queue.map(renderQueueItem).join("") || "<p>No queue items.</p>"}</section>
  </main>
</body>
</html>`;
}

function renderEvent(event) {
  return `<article class="event ${escapeHtml(event.notification?.severity ?? "")}">
    <header><strong>${escapeHtml(event.elementLabel || event.selector || "Interaction")}</strong><span>${escapeHtml(event.outcome)}</span></header>
    <p>${escapeHtml(event.declaredIntent || "No declared expectation")}</p>
    ${event.notification ? `<p><b>${escapeHtml(event.notification.severity)}</b>: ${escapeHtml(event.notification.reason)} (${escapeHtml(event.notification.status)})</p>` : ""}
    <small>${escapeHtml(event.pageUrl)} at ${escapeHtml(event.timestamp)}</small>
  </article>`;
}

function renderQueueItem(item) {
  return `<article class="queue"><p>${escapeHtml(item.text)}</p><small>${escapeHtml(item.sent ? "sent" : "queued")} ${escapeHtml(item.createdAt)}</small></article>`;
}

function reportCss() {
  return "body{font:14px/1.45 system-ui,sans-serif;margin:0;color:#1c1f24;background:#f6f7f9}header,main{max-width:960px;margin:0 auto;padding:24px}section{margin:24px 0}dl{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}dt{color:#667085}dd{font-size:24px;margin:0}.event,.queue{background:white;border:1px solid #dfe3e8;border-radius:8px;padding:12px;margin:10px 0}.event.high{border-color:#d44747}.event.likely{border-color:#d59624}.event.info{border-color:#4782d4}.event header{display:flex;justify-content:space-between;gap:12px}small{color:#667085}@media(max-width:700px){dl{grid-template-columns:repeat(2,1fr)}}";
}

/** @param {string} value */
function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
