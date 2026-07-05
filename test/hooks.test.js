import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { codexPromptMarkdown, contextMarkdown, installHooks, slashCommandMarkdown } from "../src/hooks.js";

test("contextMarkdown includes core Fathom commands", () => {
  const text = contextMarkdown("http://127.0.0.1:4765");

  assert.match(text, /fathom notify <origin>/);
  assert.match(text, /fathom poll <origin>/);
});

test("slashCommandMarkdown defines the slash-command workflow", () => {
  const text = slashCommandMarkdown("http://127.0.0.1:4765");

  assert.match(text, /# \/fathom/);
  assert.match(text, /fathom notify <origin>/);
  assert.match(text, /Do not invent interaction results/);
});

test("codexPromptMarkdown defines a Codex custom prompt", () => {
  const text = codexPromptMarkdown("http://127.0.0.1:4765");

  assert.match(text, /description:/);
  assert.match(text, /fathom notify <origin>/);
  assert.match(text, /\$ARGUMENTS/);
});

test("installHooks writes portable context and slash command files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fathom-hooks-"));
  const codexPromptsDir = await mkdtemp(path.join(os.tmpdir(), "fathom-codex-prompts-"));
  const result = await installHooks({ dir, codexPromptsDir, serverUrl: "http://127.0.0.1:9999" });

  assert.equal(result.files.length, 8);
  assert.match(await readFile(path.join(dir, "fathom-context.md"), "utf8"), /127\.0\.0\.1:9999/);
  assert.match(await readFile(path.join(dir, "fathom-session.env"), "utf8"), /FATHOM_SERVER_URL=/);
  assert.match(await readFile(path.join(dir, "fathom-context.js"), "utf8"), /Use fathom notify/);
  assert.match(await readFile(path.join(dir, "fathom.md"), "utf8"), /# \/fathom/);
  assert.match(await readFile(path.join(dir, "claude", "commands", "fathom.md"), "utf8"), /fathom poll <origin>/);
  assert.match(await readFile(path.join(dir, "codex", "fathom.md"), "utf8"), /Fathom server/);
  assert.match(await readFile(path.join(codexPromptsDir, "fathom.md"), "utf8"), /argument-hint/);
  assert.match(await readFile(path.join(dir, "opencode", "fathom.md"), "utf8"), /Fathom server/);
  assert.equal(result.commands.claudeCode, path.join(dir, "claude", "commands", "fathom.md"));
  assert.match(result.commands.codexPrompt, /fathom\.md$/);
  assert.match(result.instructions[0], /.claude\/commands\/fathom\.md/);
  assert.match(result.instructions[2], /\/prompts:fathom/);
});
