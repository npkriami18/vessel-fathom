# vessel-fathom

Fathom is a local-first CLI for observing live app interactions and sending approved human feedback back to an agent harness.

## Local use

```powershell
corepack pnpm install
corepack pnpm run build
node .\bin\fathom.js server 4765
```

In another terminal, start your app and open a Fathom session:

```powershell
node .\bin\fathom.js open http://localhost:3000
```

Open the returned `chromeUrl`, click around the app, then inspect feedback:

```powershell
node .\bin\fathom.js notify http://localhost:3000
node .\bin\fathom.js poll http://localhost:3000
```

## `/fathom` harness command

Generate reusable command prompts:

```powershell
node .\bin\fathom.js setup hooks
```

This writes files under `~/.fathom/hooks`, including:

```text
~/.fathom/hooks/fathom.md
~/.fathom/hooks/claude/commands/fathom.md
~/.fathom/hooks/codex/fathom.md
~/.fathom/hooks/opencode/fathom.md
```

For Claude Code project slash-command usage, copy or symlink:

```text
~/.fathom/hooks/claude/commands/fathom.md
```

to your project as:

```text
.claude/commands/fathom.md
```

Then use `/fathom` in Claude Code. For other harnesses, import or copy `~/.fathom/hooks/fathom.md` into that harness's custom command/prompt mechanism.
