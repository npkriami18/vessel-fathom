import assert from "node:assert/strict";
import test from "node:test";

import { captureSnapshot, declaredIntentFor, elementKind, hashString, labelFor, selectorFor } from "../src/browser/observer-sdk.js";

class FakeElement {
  constructor(tagName, attrs = {}, textContent = "") {
    this.tagName = tagName.toUpperCase();
    this.attrs = attrs;
    this.id = attrs.id ?? "";
    this.textContent = textContent;
    this.outerHTML = attrs.outerHTML ?? `<${tagName}>${textContent}</${tagName}>`;
  }

  getAttribute(name) {
    return this.attrs[name] ?? null;
  }

  closest(selector) {
    if (selector === "[data-fathom-expect]" && this.attrs["data-fathom-expect"]) return this;
    if (selector === "[data-lavish-expect]" && this.attrs["data-lavish-expect"]) return this;
    if (selector === "[data-fathom-region]" && this.attrs["data-fathom-region"]) return this;
    if (selector === "[data-lavish-region]" && this.attrs["data-lavish-region"]) return this;
    return null;
  }
}

test("hashString is stable and sensitive to DOM changes", () => {
  assert.equal(hashString("<button>A</button>"), hashString("<button>A</button>"));
  assert.notEqual(hashString("<button>A</button>"), hashString("<button>B</button>"));
});

test("element helpers extract selector, label, kind, and declared intent", () => {
  const element = new FakeElement("button", { id: "checkout", "data-fathom-expect": "navigates" }, " Checkout ");

  assert.equal(selectorFor(element), "#checkout");
  assert.equal(labelFor(element), "Checkout");
  assert.equal(elementKind(element), "button");
  assert.equal(declaredIntentFor(element), "navigates");
});

test("captureSnapshot hashes the nearest fathom region", () => {
  const region = new FakeElement(
    "section",
    { "data-fathom-region": "cart", outerHTML: "<section data-fathom-region='cart'>A</section>" },
    "A"
  );
  const win = {
    Element: FakeElement,
    document: { body: new FakeElement("body", { outerHTML: "<body>ignored</body>" }) },
    location: { href: "http://localhost:3000/cart" }
  };

  const snapshot = captureSnapshot(win, region, [], []);

  assert.equal(snapshot.url, "http://localhost:3000/cart");
  assert.equal(snapshot.domHash, hashString(region.outerHTML));
});
