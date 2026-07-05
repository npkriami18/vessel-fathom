import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";

import { runCli } from "../src/cli.js";

class BufferStream extends Writable {
  constructor() {
    super();
    this.output = "";
  }

  _write(chunk, _encoding, callback) {
    this.output += chunk.toString();
    callback();
  }
}

function response(body, ok = true) {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 400,
    headers: { "content-type": "application/json" }
  });
}

test("help prints command usage", async () => {
  const stdout = new BufferStream();
  const code = await runCli(["help"], { stdout });

  assert.equal(code, 0);
  assert.match(stdout.output, /Usage: fathom <command>/);
  assert.match(stdout.output, /open <url>/);
});

test("open posts a session request", async () => {
  const stdout = new BufferStream();
  const calls = [];
  const code = await runCli(["open", "http://localhost:3000/cart"], {
    stdout,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response({ ok: true, session: { origin: "http://localhost:3000" } });
    }
  });

  assert.equal(code, 0);
  assert.equal(calls[0].url, "http://127.0.0.1:4765/api/sessions");
  assert.equal(JSON.parse(calls[0].options.body).url, "http://localhost:3000/cart");
  assert.equal(JSON.parse(stdout.output).ok, true);
});

test("poll posts queue drain for an origin with the local token", async () => {
  const stdout = new BufferStream();
  const calls = [];
  const code = await runCli(["poll", "http://localhost:3000"], {
    stdout,
    env: { FATHOM_TOKEN: "secret-token" },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response({ ok: true, queue: [], empty: true });
    }
  });

  assert.equal(code, 0);
  assert.equal(calls[0].url, "http://127.0.0.1:4765/api/poll");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["x-fathom-token"], "secret-token");
  assert.equal(JSON.parse(calls[0].options.body).origin, "http://localhost:3000");
  assert.equal(JSON.parse(stdout.output).empty, true);
});

test("poll reads token from the configured state dir", async () => {
  const stdout = new BufferStream();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "fathom-cli-token-"));
  await writeFile(path.join(stateDir, "token"), "file-token\n", "utf8");
  const calls = [];
  const code = await runCli(["poll", "http://localhost:3000"], {
    stdout,
    env: { FATHOM_STATE_DIR: stateDir },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response({ ok: true, queue: [], empty: true });
    }
  });

  assert.equal(code, 0);
  assert.equal(calls[0].options.headers["x-fathom-token"], "file-token");
});

test("unknown commands fail with usage", async () => {
  const stderr = new BufferStream();
  const code = await runCli(["wat"], { stderr });

  assert.equal(code, 1);
  assert.match(stderr.output, /Unknown command: wat/);
});

test("export posts a report request", async () => {
  const stdout = new BufferStream();
  const calls = [];
  const code = await runCli(["export", "http://localhost:3000"], {
    stdout,
    env: { FATHOM_TOKEN: "secret-token" },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response({ ok: true, report: { jsonPath: "a.json", htmlPath: "a.html" } });
    }
  });

  assert.equal(code, 0);
  assert.equal(calls[0].url, "http://127.0.0.1:4765/api/export");
  assert.equal(calls[0].options.headers["x-fathom-token"], "secret-token");
  assert.equal(JSON.parse(calls[0].options.body).origin, "http://localhost:3000");
});

test("setup hooks installs slash-command files", async () => {
  const stdout = new BufferStream();
  const home = await mkdtemp(path.join(os.tmpdir(), "fathom-cli-home-"));
  const code = await runCli(["setup", "hooks"], {
    stdout,
    env: { HOME: home, USERPROFILE: home, FATHOM_SERVER_URL: "http://127.0.0.1:9999" }
  });
  const body = JSON.parse(stdout.output);

  assert.equal(code, 0);
  assert.equal(body.ok, true);
  assert.match(body.commands.claudeCode, /fathom\.md$/);
  assert.match(body.instructions[0], /.claude\/commands\/fathom\.md/);
});
