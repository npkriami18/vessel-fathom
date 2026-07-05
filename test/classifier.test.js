import assert from "node:assert/strict";
import test from "node:test";

import { classifyOutcome, interactionFromPayload, scoreNotification } from "../src/classifier.js";

test("classifyOutcome detects no_change", () => {
  assert.equal(classifyOutcome({ url: "/cart", domHash: "a" }, { url: "/cart", domHash: "a" }, []), "no_change");
});

test("classifyOutcome detects single-effect outcomes", () => {
  assert.equal(classifyOutcome({ url: "/cart", domHash: "a" }, { url: "/confirm", domHash: "a" }, []), "navigation");
  assert.equal(classifyOutcome({ url: "/cart", domHash: "a" }, { url: "/cart", domHash: "b" }, []), "dom_mutation");
  assert.equal(classifyOutcome({ url: "/cart", domHash: "a" }, { url: "/cart", domHash: "a" }, [{ url: "/api" }]), "network_call");
});

test("classifyOutcome returns combination for multiple effects", () => {
  assert.equal(classifyOutcome({ url: "/cart", domHash: "a" }, { url: "/confirm", domHash: "b" }, [{ url: "/api" }]), "combination");
});

test("scoreNotification follows architecture section 6", () => {
  assert.deepEqual(scoreNotification({ declaredIntent: "navigates", outcome: "no_change" }), {
    severity: "high",
    reason: "declared intent, zero observed effect",
    status: "open"
  });
  assert.deepEqual(scoreNotification({ declaredIntent: "navigates", outcome: "dom_mutation", judgment: { verdict: "mismatch" } }), {
    severity: "likely",
    reason: "declared intent did not match observed effect",
    status: "open"
  });
  assert.deepEqual(scoreNotification({ declaredIntent: null, outcome: "no_change", elementKind: "button" }), {
    severity: "info",
    reason: "no expectation declared, but nothing happened",
    status: "open"
  });
  assert.equal(scoreNotification({ declaredIntent: null, outcome: "dom_mutation", elementKind: "button" }), null);
});

test("interactionFromPayload classifies SDK payloads into timeline input", () => {
  const event = interactionFromPayload({
    selector: "#checkout",
    elementLabel: "Checkout",
    elementKind: "button",
    declaredIntent: "navigates to /confirm",
    before: { url: "http://localhost:3000/cart", domHash: "a", screenshot: "before.png" },
    after: { url: "http://localhost:3000/cart", domHash: "a", screenshot: "after.png" },
    networkCalls: [],
    consoleErrors: []
  });

  assert.equal(event.outcome, "no_change");
  assert.equal(event.notification?.severity, "high");
  assert.equal(event.before.url, "http://localhost:3000/cart");
  assert.deepEqual(event.after.pendingNetworkCalls, []);
});
