#!/usr/bin/env node
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";

import * as esbuild from "esbuild";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

await mkdir("dist", { recursive: true });

await esbuild.build({
  entryPoints: ["src/cli.js"],
  outfile: "dist/cli.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: "#!/usr/bin/env node"
  },
  define: {
    "process.env.FATHOM_BUILD_VERSION": JSON.stringify(packageJson.version)
  }
});
await chmod("dist/cli.mjs", 0o755);

await esbuild.build({
  entryPoints: ["src/browser/observer-sdk.js"],
  outfile: "dist/observer-sdk.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: false,
  minify: true
});

await copyFile("src/chrome-client.js", "dist/chrome-client.js");
await copyFile("src/chrome.css", "dist/chrome.css");

console.log("build: bundled dist/cli.mjs and dist/observer-sdk.js");
