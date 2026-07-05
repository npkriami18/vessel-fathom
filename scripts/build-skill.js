#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";

const skillPath = new URL("../skills/fathom/SKILL.md", import.meta.url);
const checkOnly = process.argv.includes("--check");

await access(skillPath);
const markdown = await readFile(skillPath, "utf8");
const errors = validateSkill(markdown);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`build-skill: ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(checkOnly ? "build-skill: skill package is valid" : "build-skill: skills/fathom is ready");
}

function validateSkill(markdown) {
  const errors = [];
  if (!markdown.startsWith("---\n")) {
    errors.push("SKILL.md must start with YAML frontmatter");
  }
  if (!/^name:\s*fathom$/m.test(markdown)) {
    errors.push("frontmatter must include name: fathom");
  }
  if (!/^description:\s*.+$/m.test(markdown)) {
    errors.push("frontmatter must include a description");
  }
  for (const command of ["open", "poll", "notify", "end", "export"]) {
    if (!markdown.includes(`fathom ${command}`)) {
      errors.push(`SKILL.md must document fathom ${command}`);
    }
  }
  return errors;
}
