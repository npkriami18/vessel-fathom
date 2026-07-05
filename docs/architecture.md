# Architecture Doc: Interaction Verification Layer (working name: "Lavish Pro")

## 1. Purpose

Lavish lets a human comment on a static AI-generated HTML artifact and send that
feedback back to the coding agent. This project extends that loop to **live,
multi-page, interactive applications**, where the thing being reviewed isn't just
"does this look right" but "does clicking this actually do what it was supposed to?"

A human still drives the browser and performs every interaction — nothing here
automates clicking. The tool's job is to **observe, diff, classify, and flag**
what happened after each interaction, so the human is triaging a short list of
likely problems instead of hunting through the whole app for bugs.

## 2. Goals / Non-goals

**Goals**

- Work across multi-page apps and SPAs, not just a single static file.
- Let elements declare an expected effect inline, without a separate manifest
  file that can drift out of sync.
- Detect and classify what actually happened after a human interaction (nav,
  DOM mutation, network call, or nothing).
- Surface likely mismatches as approvable notifications, not raw noise.
- Preserve the existing Lavish queue-and-iterate UX: human comments get queued
  and sent back to the agent, editable before sending.
- Keep an addressable, evidence-backed timeline so a human can comment on an
  action even after the state that produced it is gone (e.g. after navigating
  away, or after a modal auto-closed).

**Non-goals (v1)**

- No automated clicking/scripting of the app (human-driven only).
- No cross-browser test replay engine (that's a natural v2, not v1).
- No requirement that every element have a declared intent — the system
  should still be useful on an app with zero annotations, just with less
  precision.

## 3. High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Human's browser                                             │
│  ┌─────────────────────────────┐   ┌───────────────────────┐│
│  │  App under review (iframe    │   │  Lavish Pro panel      ││
│  │  or same-origin live page)   │   │  - Timeline            ││
│  │  + injected Observer SDK     │◄──┤  - Notifications       ││
│  │                               │   │  - Comment queue       ││
│  └──────────────┬────────────────┘   └───────────┬───────────┘│
│                 │ events (postMessage / direct)   │           │
└─────────────────┼──────────────────────────────────┼───────────┘
                  ▼                                  ▼
        ┌───────────────────────────────────────────────────┐
        │  Local Lavish Pro server (Node, localhost)         │
        │  - Session store (keyed by app origin)             │
        │  - Page graph                                      │
        │  - Interaction log / timeline                      │
        │  - Classifier + LLM judge                          │
        │  - Comment queue                                   │
        └───────────────────┬─────────────────────────────────┘
                             │ CLI: `lavish poll` / `lavish notify`
                             ▼
                     Coding agent (Claude Code, etc.)
```

The server is the same shape as Lavish's today (local, file/state under
`~/.lavish-pro/`, idle auto-shutdown) — it just tracks a session per **app
origin** instead of per file path, since the human will move across pages.

## 4. Data model

### 4.1 Session

```ts
Session {
  id: string                 // hash of app origin, e.g. localhost:3000
  origin: string
  startedAt: timestamp
  pages: PageNode[]           // discovered as the human navigates
  timeline: InteractionEvent[]
  queue: QueueItem[]          // comments waiting to be sent to the agent
}
```

### 4.2 PageNode

```ts
PageNode {
  url: string
  title: string
  firstVisitedAt: timestamp
  discoveredVia?: interactionEventId   // which click led here, if any
}
```

The page graph is just a byproduct: an edge from `discoveredVia` to this node.
Not load-bearing for v1, but cheap to keep and useful as documentation of the
app's navigable surface.

### 4.3 InteractionEvent (the core unit — the "timeline entry")

```ts
InteractionEvent {
  id: string
  timestamp: timestamp
  pageUrl: string                 // page it happened on
  selector: string                // best-effort CSS selector / accessible name
  elementLabel: string            // visible text / aria-label, for human readability
  declaredIntent: string | null   // from data-lavish-expect, if present

  before: Snapshot
  after: Snapshot

  outcome: Outcome                // classification result
  judgment: Judgment | null       // LLM comparison, only if declaredIntent existed

  notification: NotificationFlag | null
  comments: CommentRef[]          // links into queue, may be zero or more
}
```

### 4.4 Snapshot

```ts
Snapshot {
  url: string
  domHash: string          // cheap fingerprint for fast no-change detection
  domSubtreeDiff?: string  // populated only if domHash changed, computed lazily
  screenshot: string       // local file ref, thumbnail + full
  pendingNetworkCalls: NetworkCallSummary[]  // captured in the settle window
  consoleErrors: string[]
}
```

### 4.5 Outcome (auto-classified, no LLM needed)

```ts
type Outcome = "no_change" | "navigation" | "dom_mutation" | "network_call" | "combination"; // e.g. dom_mutation + network_call
```

### 4.6 Judgment (only computed when declaredIntent is present)

```ts
Judgment {
  verdict: "match" | "mismatch" | "partial" | "unclear"
  reasoning: string        // short, shown to human alongside the verdict
  confidence: number       // 0-1
}
```

### 4.7 NotificationFlag

```ts
NotificationFlag {
  severity: "high" | "likely" | "info"
  reason: string     // "declared intent, zero observed effect" etc.
  status: "open" | "approved" | "dismissed"
}
```

### 4.8 QueueItem (feeds into the existing send-to-agent mechanism)

```ts
QueueItem {
  id: string
  sourceEventId: string | null   // null if it's a free-floating comment, same as today
  text: string
  createdAt: timestamp
  sent: boolean
}
```

## 5. Event schema (SDK → server wire format)

The injected Observer SDK posts a single message shape for every instrumented
interaction:

```json
{
  "type": "lavish.interaction",
  "selector": "#checkout-btn",
  "elementLabel": "Checkout",
  "declaredIntent": "navigates to /confirm and clears cart badge",
  "before": { "domHash": "a1b2...", "url": "/cart", "screenshot": "..." },
  "after": { "domHash": "a1b2...", "url": "/cart", "screenshot": "..." },
  "networkCalls": [],
  "consoleErrors": []
}
```

The SDK is responsible for capturing `before` synchronously on
`pointerdown`/`keydown` (before any handler runs), then waiting a **settle
window** (default ~600ms, configurable, extended if network activity is
in-flight) before capturing `after` and posting the full event.

## 6. Classification pipeline

1. **Fast path (no LLM):** compare `domHash` before/after, compare `url`
   before/after, check if `networkCalls` is non-empty → gives `Outcome`
   directly, cheap and deterministic.
2. **Judgment path (LLM, only if `declaredIntent` is set):** send
   `{ declaredIntent, outcome, domSubtreeDiff, networkCalls }` to a small judge
   prompt, get back `Judgment`.
3. **Notification scoring:**
   - `declaredIntent` present + `outcome == no_change` → `severity: high`
     (dead button), no LLM call needed to flag it, though the LLM judgment can
     still run for the human's context.
   - `declaredIntent` present + `Judgment.verdict == mismatch` → `severity: likely`
   - No `declaredIntent`, but element is a button/link and `outcome == no_change`
     → `severity: info` ("no expectation declared, but nothing happened —
     worth checking?")
   - Otherwise → no notification, entry just sits in the timeline.

## 7. Human-facing flow

1. Human clicks around the live app as normal.
2. Every instrumented interaction lands in the **Timeline**, visible in full
   regardless of flagging.
3. Flagged entries additionally surface in the **Notifications** feed, each
   with Approve / Dismiss / Comment-directly actions (see prior discussion).
4. Approving auto-fills a queue comment from the template:
   `"Expected {declaredIntent}, but observed {outcome}."` — editable before
   queuing.
5. Human can also click any timeline entry (flagged or not) at any time and
   add a free-form comment, same mechanic — this is what makes it work even
   after the human has navigated away from the page where it happened.
6. Queue behaves exactly as it does in Lavish today: batched, editable, sent
   to the agent via `lavish poll`.

## 8. SDK responsibilities (injected into the app)

- Attach capture-phase listeners for `click`, `submit`, `keydown` (Enter on
  focused interactive elements) on `document`, not per-element — so it works
  without the app cooperating beyond adding `data-lavish-expect` attributes.
- Compute `domHash` cheaply (e.g. a rolling hash over serialized outerHTML of
  a bounded region, not the whole document, to stay fast on large apps).
- Buffer network calls via `fetch`/`XHR` monkey-patch during the settle
  window.
- Strip all `data-lavish-*` attributes and remove itself cleanly on export —
  same principle as today's Lavish, output must be identical to a
  non-instrumented run.

## 9. Open questions to resolve before/during prototyping

- **Settle window tuning**: fixed timeout vs. adaptive (wait for network
  idle + a debounce on DOM mutations)? Adaptive is more correct but adds
  complexity.
- **domHash granularity**: whole-document vs. scoped to nearest
  `data-lavish-region` boundary, to avoid false positives from unrelated
  background changes (e.g. a clock ticking).
- **LLM judge cost**: batch judgments per session rather than per click, to
  keep latency and cost down, at the expense of instant feedback.
- **Cross-page timeline continuity**: when the human navigates via a link
  that's _not_ the flagged interaction (e.g. browser back button), how much
  do we bother reconciling the page graph vs. just letting it be approximate.

## 10. Suggested build order (v1 prototype)

1. Observer SDK: capture-phase listeners, domHash, screenshot, event posting.
2. Local server: session store keyed by origin, timeline persistence,
   `poll`/`notify` CLI commands matching Lavish's existing interface shape.
3. Fast-path classifier (no LLM) — ship this alone first, it's most of the
   value.
4. Timeline + Notifications UI panel.
5. LLM judge pass, layered on top once the fast path is solid.
6. Page graph (nice-to-have, low priority relative to the above).
