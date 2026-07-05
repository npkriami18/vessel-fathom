const DEFAULT_SETTLE_MS = 600;
const HARD_CAP_MS = 3000;
const ATTR_EXPECT = ["data-fathom-expect", "data-lavish-expect"];
const ATTR_REGION = ["[data-fathom-region]", "[data-lavish-region]"];

export function installObserver(options = {}) {
  const win = options.window ?? globalThis.window;
  if (!win?.document || win.__fathomObserverInstalled) return null;

  const observer = createObserver(win, options);
  observer.start();
  win.__fathomObserverInstalled = observer;
  return observer;
}

export function createObserver(win, options = {}) {
  const doc = win.document;
  const endpoint = options.endpoint ?? "/api/interactions";
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const beforeSnapshots = new WeakMap();
  const network = createNetworkBuffer(win);
  const consoleErrors = [];
  const originalConsoleError = win.console?.error;

  function start() {
    network.patch();
    if (win.console && typeof originalConsoleError === "function") {
      win.console.error = (...args) => {
        consoleErrors.push(args.map(String).join(" "));
        originalConsoleError.apply(win.console, args);
      };
    }
    doc.addEventListener("pointerdown", captureBefore, true);
    doc.addEventListener("click", handleInteraction, true);
    doc.addEventListener("submit", handleInteraction, true);
    doc.addEventListener("keydown", handleKeydown, true);
  }

  function stop() {
    doc.removeEventListener("pointerdown", captureBefore, true);
    doc.removeEventListener("click", handleInteraction, true);
    doc.removeEventListener("submit", handleInteraction, true);
    doc.removeEventListener("keydown", handleKeydown, true);
    network.restore();
    if (win.console && originalConsoleError) win.console.error = originalConsoleError;
    delete win.__fathomObserverInstalled;
  }

  function captureBefore(event) {
    const target = event.target instanceof win.Element ? event.target : null;
    if (!target) return;
    beforeSnapshots.set(target, captureSnapshot(win, target, network.calls(), consoleErrors));
  }

  function handleKeydown(event) {
    if (event.key !== "Enter") return;
    captureBefore(event);
    handleInteraction(event);
  }

  function handleInteraction(event) {
    const target = event.target instanceof win.Element ? event.target : null;
    if (!target) return;
    const before = beforeSnapshots.get(target) ?? captureSnapshot(win, target, network.calls(), consoleErrors);
    const networkStart = network.calls().length;
    waitForSettle(network, settleMs).then(() => {
      const after = captureSnapshot(win, target, network.calls(), consoleErrors);
      const networkCalls = network.calls().slice(networkStart);
      const payload = {
        type: "lavish.interaction",
        selector: selectorFor(target),
        elementLabel: labelFor(target),
        elementKind: elementKind(target),
        declaredIntent: declaredIntentFor(target),
        before,
        after,
        networkCalls,
        consoleErrors: [...consoleErrors]
      };
      postInteraction(win, endpoint, payload);
    });
  }

  return { start, stop, captureSnapshot: (target = doc.body) => captureSnapshot(win, target, network.calls(), consoleErrors) };
}

export function captureSnapshot(win, target, networkCalls = [], consoleErrors = []) {
  const region = nearestRegion(win, target) ?? win.document.body;
  return {
    url: win.location.href,
    domHash: hashString(region?.outerHTML ?? ""),
    screenshot: "",
    pendingNetworkCalls: networkCalls,
    consoleErrors: [...consoleErrors]
  };
}

export function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function selectorFor(element) {
  if (element.id) return `#${cssEscape(element.id)}`;
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${cssEscape(testId)}"]`;
  const name = element.getAttribute("name");
  if (name) return `${element.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
  return element.tagName.toLowerCase();
}

export function labelFor(element) {
  return (element.getAttribute("aria-label") || element.textContent || element.getAttribute("value") || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

export function declaredIntentFor(element) {
  for (const attr of ATTR_EXPECT) {
    const owner = element.closest?.(`[${attr}]`);
    const value = owner?.getAttribute(attr);
    if (value) return value;
  }
  return null;
}

export function elementKind(element) {
  const tag = element.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "form") return "submit";
  if (tag === "input" && ["button", "submit"].includes(element.getAttribute("type") ?? "")) return "button";
  return tag;
}

function nearestRegion(win, target) {
  if (!(target instanceof win.Element)) return null;
  for (const selector of ATTR_REGION) {
    const region = target.closest(selector);
    if (region) return region;
  }
  return null;
}

async function waitForSettle(network, settleMs) {
  const started = Date.now();
  await delay(settleMs);
  while (network.inFlight() > 0 && Date.now() - started < HARD_CAP_MS) {
    await delay(100);
  }
}

function postInteraction(win, endpoint, payload) {
  if (win.parent && win.parent !== win) {
    win.parent.postMessage(payload, "*");
  }
  if (typeof win.fetch === "function") {
    win
      .fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      })
      .catch(() => {});
  }
}

function createNetworkBuffer(win) {
  const calls = [];
  let inFlight = 0;
  const originalFetch = win.fetch;
  const OriginalXHR = win.XMLHttpRequest;

  return {
    patch() {
      if (typeof originalFetch === "function") {
        win.fetch = async (...args) => {
          const startedAt = new Date().toISOString();
          inFlight += 1;
          try {
            const response = await originalFetch(...args);
            calls.push({ type: "fetch", url: String(args[0]), status: response.status, startedAt, endedAt: new Date().toISOString() });
            return response;
          } catch (error) {
            calls.push({ type: "fetch", url: String(args[0]), error: String(error), startedAt, endedAt: new Date().toISOString() });
            throw error;
          } finally {
            inFlight -= 1;
          }
        };
      }

      if (typeof OriginalXHR === "function") {
        win.XMLHttpRequest = function FathomXHR() {
          const xhr = new OriginalXHR();
          let method = "GET";
          let url = "";
          const originalOpen = xhr.open;
          xhr.open = function open(nextMethod, nextUrl, ...rest) {
            method = String(nextMethod);
            url = String(nextUrl);
            return originalOpen.call(xhr, nextMethod, nextUrl, ...rest);
          };
          xhr.addEventListener("loadstart", () => {
            inFlight += 1;
          });
          xhr.addEventListener("loadend", () => {
            inFlight -= 1;
            calls.push({ type: "xhr", method, url, status: xhr.status, endedAt: new Date().toISOString() });
          });
          return xhr;
        };
      }
    },
    restore() {
      if (originalFetch) win.fetch = originalFetch;
      if (OriginalXHR) win.XMLHttpRequest = OriginalXHR;
    },
    calls: () => calls,
    inFlight: () => inFlight
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value).replaceAll('"', '\\"');
}

installObserver();
