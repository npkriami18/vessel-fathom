import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { declaredIntentFromFlow, findFlow, loadFlowsManifest } from "../src/flows.js";

test("loadFlowsManifest reads fathom.flows.json from app root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fathom-flows-"));
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "fathom.flows.json"), JSON.stringify({ checkout: { expect: "navigates to /confirm" } }), "utf8");

  const manifest = await loadFlowsManifest(root);

  assert.deepEqual(manifest, { checkout: { expect: "navigates to /confirm" } });
});

test("findFlow supports top-level and nested flows maps", () => {
  assert.deepEqual(findFlow({ checkout: { expect: "a" } }, "checkout"), { expect: "a" });
  assert.deepEqual(findFlow({ flows: { checkout: { expect: "b" } } }, "checkout"), { expect: "b" });
  assert.equal(findFlow({ flows: {} }, "missing"), null);
});

test("declaredIntentFromFlow extracts common intent fields", () => {
  assert.equal(declaredIntentFromFlow({ expect: "expected" }), "expected");
  assert.equal(declaredIntentFromFlow({ intent: "intent" }), "intent");
  assert.equal(declaredIntentFromFlow({ description: "description" }), "description");
  assert.equal(declaredIntentFromFlow({}), null);
});
