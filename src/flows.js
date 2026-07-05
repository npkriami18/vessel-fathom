import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * @param {string} appRoot
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadFlowsManifest(appRoot) {
  const file = path.join(appRoot, "fathom.flows.json");
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("fathom.flows.json must contain an object");
  }
  return parsed;
}

/**
 * @param {Record<string, unknown>} manifest
 * @param {string | null | undefined} flowId
 * @returns {unknown | null}
 */
export function findFlow(manifest, flowId) {
  if (!flowId) return null;
  if (Object.hasOwn(manifest, flowId)) return manifest[flowId];
  const flows = manifest.flows;
  if (flows && typeof flows === "object" && !Array.isArray(flows) && Object.hasOwn(flows, flowId)) {
    return flows[flowId];
  }
  return null;
}

/**
 * @param {unknown} flow
 * @returns {string | null}
 */
export function declaredIntentFromFlow(flow) {
  if (!flow || typeof flow !== "object") return null;
  if (typeof flow.expect === "string") return flow.expect;
  if (typeof flow.intent === "string") return flow.intent;
  if (typeof flow.description === "string") return flow.description;
  return null;
}
