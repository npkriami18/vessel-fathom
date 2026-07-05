import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_HOOK_DIR = path.join(os.homedir(), ".fathom", "hooks");
const DEFAULT_CODEX_PROMPTS_DIR = path.join(os.homedir(), ".codex", "prompts");

/**
 * @param {{ dir?: string, codexPromptsDir?: string, serverUrl?: string }} [options]
 * @returns {Promise<{ dir: string, files: string[], commands: Record<string, string>, instructions: string[] }>}
 */
export async function installHooks(options = {}) {
  const dir = options.dir ?? DEFAULT_HOOK_DIR;
  const serverUrl = options.serverUrl ?? "http://127.0.0.1:4765";
  const codexPromptsDir = options.codexPromptsDir ?? DEFAULT_CODEX_PROMPTS_DIR;
  await mkdir(dir, { recursive: true });

  const contextPath = path.join(dir, "fathom-context.md");
  const envPath = path.join(dir, "fathom-session.env");
  const scriptPath = path.join(dir, "fathom-context.js");
  const commandPath = path.join(dir, "fathom.md");
  const claudeCommandPath = path.join(dir, "claude", "commands", "fathom.md");
  const codexCommandPath = path.join(dir, "codex", "fathom.md");
  const codexPromptPath = path.join(codexPromptsDir, "fathom.md");
  const opencodeCommandPath = path.join(dir, "opencode", "fathom.md");

  await mkdir(path.dirname(claudeCommandPath), { recursive: true });
  await mkdir(path.dirname(codexCommandPath), { recursive: true });
  await mkdir(codexPromptsDir, { recursive: true });
  await mkdir(path.dirname(opencodeCommandPath), { recursive: true });

  const command = slashCommandMarkdown(serverUrl);
  await writeFile(contextPath, contextMarkdown(serverUrl), "utf8");
  await writeFile(envPath, `FATHOM_SERVER_URL=${serverUrl}\n`, "utf8");
  await writeFile(scriptPath, contextScript(serverUrl), "utf8");
  await writeFile(commandPath, command, "utf8");
  await writeFile(claudeCommandPath, command, "utf8");
  await writeFile(codexCommandPath, command, "utf8");
  await writeFile(codexPromptPath, codexPromptMarkdown(serverUrl), "utf8");
  await writeFile(opencodeCommandPath, command, "utf8");

  return {
    dir,
    files: [contextPath, envPath, scriptPath, commandPath, claudeCommandPath, codexCommandPath, codexPromptPath, opencodeCommandPath],
    commands: {
      generic: commandPath,
      claudeCode: claudeCommandPath,
      codex: codexCommandPath,
      codexPrompt: codexPromptPath,
      opencode: opencodeCommandPath
    },
    instructions: [
      `Claude Code project command: copy ${claudeCommandPath} to .claude/commands/fathom.md`,
      `Generic harness command prompt: import or copy ${commandPath}`,
      `Codex CLI custom prompt installed at ${codexPromptPath}; restart Codex and invoke /prompts:fathom`,
      `Codex/OpenCode prompt copies are available at ${codexCommandPath} and ${opencodeCommandPath}`
    ]
  };
}

/** @param {string} serverUrl */
export function contextMarkdown(serverUrl) {
  return `# Fathom Session Context\n\nFathom server: ${serverUrl}\n\nUseful commands:\n\n- fathom notify <origin>\n- fathom poll <origin>\n- fathom end <origin>\n`;
}

/** @param {string} serverUrl */
export function contextScript(serverUrl) {
  return `#!/usr/bin/env node\nconsole.log(${JSON.stringify(`Fathom server: ${serverUrl}`)});\nconsole.log("Use fathom notify <origin> before polling for approved feedback.");\n`;
}

/** @param {string} serverUrl */
export function slashCommandMarkdown(serverUrl) {
  return `# /fathom\n\nYou are using Fathom, a local interaction-verification loop for live apps.\n\nFathom server: ${serverUrl}\n\nWhen the user invokes /fathom, do this:\n\n1. Identify the app origin. If the user supplied one, use it. Otherwise infer it from the running dev server or ask for it.\n2. Run \`fathom notify <origin>\` first. Summarize open notifications without draining queued comments.\n3. If the user wants agent feedback, run \`fathom poll <origin>\`. Treat returned queue items as approved human feedback and act on them.\n4. If no Fathom session exists, tell the user to start one with \`fathom open <url>\` after starting their app.\n5. Do not invent interaction results. Only use Fathom CLI output as evidence.\n\nUseful commands:\n\n\`\`\`sh\nfathom open <url>\nfathom notify <origin>\nfathom poll <origin>\nfathom export <origin>\nfathom end <origin>\n\`\`\`\n`;
}

/** @param {string} serverUrl */
export function codexPromptMarkdown(serverUrl) {
  return `---
description: Check Fathom notifications and approved feedback for a live app
argument-hint: [ORIGIN]
---

You are using Fathom, a local interaction-verification loop for live apps.

Fathom server: ${serverUrl}

Use the origin from $ARGUMENTS when supplied. If no origin is supplied, infer the app origin from the current repo/dev server context or ask the user for it.

Run \`fathom notify <origin>\` first and summarize open notifications without draining queued comments.

If the user wants agent feedback or fixes, run \`fathom poll <origin>\`. Treat returned queue items as approved human feedback and act on them.

If no Fathom session exists, tell the user to start the app and run \`fathom open <url>\`.

Do not invent interaction results. Only use Fathom CLI output as evidence.
`;
}
