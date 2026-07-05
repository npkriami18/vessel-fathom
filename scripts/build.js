#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const outdir = path.join(process.cwd(), "dist");
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: ["src/browser/observer-sdk.js"],
  outfile: "dist/observer-sdk.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: false,
  minify: false
});
console.log("build: bundled dist/observer-sdk.js");
