# /fathom

You are using Fathom, a local interaction-verification loop for live apps.

When the user invokes /fathom, do this:

1. Identify the app origin. If the user supplied one, use it. Otherwise infer it from the running dev server or ask for it.
2. Run `fathom notify <origin>` first. Summarize open notifications without draining queued comments.
3. If the user wants agent feedback, run `fathom poll <origin>`. Treat returned queue items as approved human feedback and act on them.
4. If no Fathom session exists, tell the user to start one with `fathom open <url>` after starting their app.
5. Do not invent interaction results. Only use Fathom CLI output as evidence.

Useful commands:

```sh
fathom open <url>
fathom notify <origin>
fathom poll <origin>
fathom export <origin>
fathom end <origin>
```
