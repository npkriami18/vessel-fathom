import assert from "node:assert/strict";
import test from "node:test";

import { injectObserverSdk, stripFathomInstrumentation } from "../src/html-transform.js";

test("injectObserverSdk inserts the observer module before head close", () => {
  const html = injectObserverSdk("<html><head><title>A</title></head><body></body></html>");

  assert.match(html, /data-fathom-sdk="true"/);
  assert.match(html, /installObserver/);
  assert.match(html, /<\/script><\/head>/);
});

test("injectObserverSdk is idempotent", () => {
  const once = injectObserverSdk("<html><head></head><body></body></html>");
  assert.equal(injectObserverSdk(once), once);
});

test("stripFathomInstrumentation removes SDK script and fathom attributes", () => {
  const stripped = stripFathomInstrumentation(
    '<button data-fathom-expect="works" data-lavish-region="x">Go</button><script data-fathom-sdk="true" type="module">x</script>'
  );

  assert.equal(stripped, "<button>Go</button>");
});
