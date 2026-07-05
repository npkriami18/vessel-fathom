import { spawn } from "node:child_process";

const DEFAULT_SERVER = "http://127.0.0.1:4765";

/**
 * @param {string[]} argv
 * @param {{ fetch?: typeof fetch, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, env?: NodeJS.ProcessEnv }} [io]
 * @returns {Promise<number>}
 */
export async function runCli(argv, io = {}) {
  const [command, value, subcommand] = argv;
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  const request = io.fetch ?? fetch;
  const env = io.env ?? process.env;
  const baseUrl = env.FATHOM_SERVER_URL ?? DEFAULT_SERVER;

  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      out.write(`${usage()}\n`);
      return 0;
    }

    if (command === "open") {
      requireValue(value, "url");
      const response = await request(`${baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: value })
      });
      await writeJson(out, response);
      return response.ok ? 0 : 1;
    }

    if (command === "poll") {
      requireValue(value, "origin");
      const response = await request(`${baseUrl}/api/poll?origin=${encodeURIComponent(value)}`);
      await writeJson(out, response);
      return response.ok ? 0 : 1;
    }

    if (command === "notify") {
      requireValue(value, "origin");
      const response = await request(`${baseUrl}/api/notify?origin=${encodeURIComponent(value)}`);
      await writeJson(out, response);
      return response.ok ? 0 : 1;
    }

    if (command === "end") {
      requireValue(value, "origin");
      const response = await request(`${baseUrl}/api/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origin: value })
      });
      await writeJson(out, response);
      return response.ok ? 0 : 1;
    }

    if (command === "server") {
      const { startServer } = await import("./server.js");
      const server = await startServer({ port: Number(value) || 4765 });
      out.write(JSON.stringify({ ok: true, port: server.port }) + "\n");
      return 0;
    }

    if (command === "stop") {
      out.write(JSON.stringify({ ok: false, error: "stop is not implemented until the daemon lifecycle is added" }) + "\n");
      return 1;
    }

    if (command === "export") {
      requireValue(value, "origin");
      const response = await request(`${baseUrl}/api/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origin: value })
      });
      await writeJson(out, response);
      return response.ok ? 0 : 1;
    }

    if (command === "setup" && value === "hooks") {
      const { installHooks } = await import("./hooks.js");
      const result = await installHooks({ serverUrl: baseUrl });
      out.write(JSON.stringify({ ok: true, ...result }) + "\n");
      return 0;
    }

    err.write(`Unknown command: ${command}\n${usage()}\n`);
    return 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    err.write(`${message}\n`);
    return 1;
  }
}

function usage() {
  return [
    "Usage: fathom <command>",
    "",
    "Commands:",
    "  open <url>",
    "  poll <origin>",
    "  notify <origin>",
    "  end <origin>",
    "  stop",
    "  server [port]",
    "  export <origin>",
    "  setup hooks"
  ].join("\n");
}

/** @param {unknown} value @param {string} name */
function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required`);
}

/** @param {NodeJS.WritableStream} out @param {Response} response */
async function writeJson(out, response) {
  const text = await response.text();
  out.write(`${text}\n`);
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
