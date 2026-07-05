---
name: fathom
description: Verify live app interactions with the Fathom CLI. Use when an agent-built web app needs browser-observed evidence that buttons, forms, navigation, or declared data-fathom-expect behaviors actually work.
argument-hint: [APP_URL_OR_ORIGIN]
author: Kun Chen (kunchenguid)
metadata:
  tags: [verification, testing, browser, ai-agent]
  category: developer-tools
---

# Fathom

Fathom is a local interaction-verification loop for live apps. It opens an app through a localhost review chrome, observes user interactions in the browser, flags likely dead or wrong-behavior UI, and lets the human approve feedback before the agent consumes it.

## Request $ARGUMENTS

If the user invokes `/fathom` with a URL or origin, use that value. If the request is empty, infer the running app origin from the conversation or ask for the origin before polling.

## When to use

Use Fathom when working on an interactive web app and you need evidence from the real browser that a control, navigation path, form, or declared expectation behaved correctly. Prefer it after building or changing UI flows, before claiming a bug is fixed, or when the user reports a dead button or silent wrong behavior.

## Workflow

1. Make sure the app and the Fathom server are running.
2. Run `npx -y vessel-fathom open <url>` to open or create a browser review session.
3. Run `npx -y vessel-fathom notify <origin>` to inspect open notifications without draining approved feedback.
4. When the user approves feedback in the Fathom chrome, run `npx -y vessel-fathom poll <origin>` and treat returned queue items as approved human feedback.
5. Apply fixes, then repeat `notify` or `poll` as needed.
6. Run `npx -y vessel-fathom export <origin>` when the user wants a portable report.
7. Run `npx -y vessel-fathom end <origin>` when the review session is finished.

## Commands

- `npx -y vessel-fathom open <url>` starts or resumes a session for a live app URL.
- `npx -y vessel-fathom notify <origin>` lists open Fathom notifications without consuming approved queue items.
- `npx -y vessel-fathom poll <origin>` drains approved feedback for the agent to act on.
- `npx -y vessel-fathom end <origin>` marks a review session ended.
- `npx -y vessel-fathom export <origin>` writes JSON and HTML reports under `~/.fathom/reports`.
- `npx -y vessel-fathom setup hooks` installs reusable harness prompts under `~/.fathom/hooks`.

## Rules

Do not invent interaction evidence. Only cite Fathom CLI output or exported reports as proof. `notify` is for inspection; `poll` consumes approved queue items. Exported reports can contain screenshots or app data, so do not share them publicly without checking their contents.
