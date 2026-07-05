/** @typedef {"no_change"|"navigation"|"dom_mutation"|"network_call"|"combination"} Outcome */

/**
 * @param {{ url?: string, domHash?: string }} before
 * @param {{ url?: string, domHash?: string }} after
 * @param {unknown[]} [networkCalls]
 * @returns {Outcome}
 */
export function classifyOutcome(before, after, networkCalls = []) {
  const changed = [];
  if ((before.url ?? "") !== (after.url ?? "")) changed.push("navigation");
  if ((before.domHash ?? "") !== (after.domHash ?? "")) changed.push("dom_mutation");
  if (networkCalls.length > 0) changed.push("network_call");

  if (changed.length === 0) return "no_change";
  if (changed.length > 1) return "combination";
  return changed[0];
}

/**
 * @param {{ declaredIntent?: string | null, outcome: Outcome, judgment?: { verdict?: string } | null, elementKind?: string | null }} input
 * @returns {{ severity: "high"|"likely"|"info", reason: string, status: "open" } | null}
 */
export function scoreNotification(input) {
  if (input.declaredIntent && input.outcome === "no_change") {
    return { severity: "high", reason: "declared intent, zero observed effect", status: "open" };
  }

  if (input.declaredIntent && input.judgment?.verdict === "mismatch") {
    return { severity: "likely", reason: "declared intent did not match observed effect", status: "open" };
  }

  if (!input.declaredIntent && input.outcome === "no_change" && isInteractiveKind(input.elementKind)) {
    return { severity: "info", reason: "no expectation declared, but nothing happened", status: "open" };
  }

  return null;
}

/** @param {string | null | undefined} kind */
function isInteractiveKind(kind) {
  return kind === "button" || kind === "link" || kind === "submit";
}

/**
 * @param {Record<string, unknown>} payload
 */
export function interactionFromPayload(payload) {
  const before = normalizeSnapshot(payload.before);
  const after = normalizeSnapshot(payload.after);
  const networkCalls = Array.isArray(payload.networkCalls) ? payload.networkCalls : [];
  const outcome = classifyOutcome(before, after, networkCalls);
  const declaredIntent = typeof payload.declaredIntent === "string" && payload.declaredIntent.length > 0 ? payload.declaredIntent : null;

  return {
    pageUrl: before.url || after.url || "",
    selector: typeof payload.selector === "string" ? payload.selector : "",
    elementLabel: typeof payload.elementLabel === "string" ? payload.elementLabel : "",
    declaredIntent,
    before: { ...before, pendingNetworkCalls: before.pendingNetworkCalls ?? [] },
    after: { ...after, pendingNetworkCalls: networkCalls },
    outcome,
    judgment: null,
    notification: scoreNotification({
      declaredIntent,
      outcome,
      judgment: null,
      elementKind: typeof payload.elementKind === "string" ? payload.elementKind : null
    })
  };
}

/** @param {unknown} value */
function normalizeSnapshot(value) {
  const snapshot = value && typeof value === "object" ? value : {};
  return {
    url: typeof snapshot.url === "string" ? snapshot.url : "",
    domHash: typeof snapshot.domHash === "string" ? snapshot.domHash : "",
    domSubtreeDiff: typeof snapshot.domSubtreeDiff === "string" ? snapshot.domSubtreeDiff : undefined,
    screenshot: typeof snapshot.screenshot === "string" ? snapshot.screenshot : "",
    pendingNetworkCalls: Array.isArray(snapshot.pendingNetworkCalls) ? snapshot.pendingNetworkCalls : [],
    consoleErrors: Array.isArray(snapshot.consoleErrors) ? snapshot.consoleErrors.map(String) : []
  };
}
