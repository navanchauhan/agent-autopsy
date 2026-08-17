#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const allowed = new Set(["codex", "claude-code", "grok", "antigravity", "qwen-code"]);
const providers = process.argv.slice(2);

if (providers.length === 0 || providers.some((provider) => !allowed.has(provider))) {
  throw new Error("Usage: update-version-counts.cjs <codex|claude-code|grok|antigravity|qwen-code> [...]");
}

function countFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name)).length;
}

for (const provider of providers) {
  const providerRoot = path.join(repoRoot, provider);
  const versionPath = path.join(providerRoot, "VERSION");
  let text = fs.readFileSync(versionPath, "utf8");
  const counts = {
    prompts: countFiles(path.join(providerRoot, "prompts"), (name) => name.endsWith(".md")),
    tools: countFiles(path.join(providerRoot, "tools"), (name) => name.endsWith(".json")),
    misc: countFiles(path.join(providerRoot, "misc"), (name) => !name.endsWith(".VERSION")),
  };
  for (const [field, value] of Object.entries(counts)) {
    const pattern = new RegExp(`^${field}\\s*=.*$`, "m");
    if (pattern.test(text)) text = text.replace(pattern, `${field} = ${value}`);
  }
  fs.writeFileSync(versionPath, text);
}

console.log(`Updated VERSION inventory counts for: ${providers.join(", ")}`);
