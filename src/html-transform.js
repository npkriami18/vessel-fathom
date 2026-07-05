const SDK_MARKER = "data-fathom-sdk";

/**
 * @param {string} html
 * @param {{ endpoint?: string, token?: string }} [options]
 */
export function injectObserverSdk(html, options = {}) {
  if (html.includes(SDK_MARKER)) return html;
  const endpoint = options.endpoint ?? "/api/interactions";
  const script = `<script ${SDK_MARKER}="true" type="module">import { installObserver } from "/observer-sdk.js"; installObserver({ endpoint: ${JSON.stringify(endpoint)}, token: ${JSON.stringify(options.token ?? "")} });</script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${script}</head>`);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${script}</body>`);
  return `${html}${script}`;
}

/** @param {string} html */
export function stripFathomInstrumentation(html) {
  return html
    .replace(/<script\s+[^>]*data-fathom-sdk="true"[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\sdata-(?:fathom|lavish)-[a-z0-9-]+=("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}
