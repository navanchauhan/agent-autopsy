#!/usr/bin/env node
// Hard guardrails for an agent-produced provider refresh. Judgement (PII,
// evidence, honesty) belongs to the reviewer; this checks what code can check.
//
// Usage: validate.cjs <provider> <version-field> <expected-version>
// Env: SECRET_VALUES_FILE (optional) - newline-separated literal secrets to forbid.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { validateManifest, renderCatalog } = require("../scripts/surface-registry.cjs");

const [provider, versionField, expected] = process.argv.slice(2);
if (!provider || !versionField || !expected) {
  console.error("usage: validate.cjs <provider> <version-field> <expected-version>");
  process.exit(2);
}
const repo = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const errors = [];
const git = (...args) => childProcess.execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd: repo, encoding: "utf8" });

const allowedExtensions = new Set([".md", ".json", ".txt", ".xml", ".cjs", ".py", ".version", ""]);
const secretPatterns = [
  ["private key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["bearer credential", /\b(?:authorization|bearer)\s*[:=]?\s*["']?(?:Bearer\s+)?[A-Za-z0-9._~+/-]{40,}/i],
  ["token-shaped value", /\b(?:gh[pousr]_|github_pat_|sk-ant-|sk-(?:proj-|svcacct-)|xai-|ya29\.|AIza)[A-Za-z0-9._-]{16,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];
const literalSecrets = (process.env.SECRET_VALUES_FILE && fs.existsSync(process.env.SECRET_VALUES_FILE)
  ? fs.readFileSync(process.env.SECRET_VALUES_FILE, "utf8").split("\n") : [])
  .map((value) => value.trim()).filter((value) => value.length >= 12);

// Scope: the change may touch only the provider directory and the generated catalog.
const changed = git("status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames")
  .split("\0").filter(Boolean).map((line) => line.slice(3));
for (const file of changed) {
  if (file !== "CATALOG.md" && !file.startsWith(`${provider}/`)) errors.push(`out of scope: ${file}`);
}

// Files: regular, small, text, expected types, parseable, and secret-free.
for (const file of changed.filter((name) => name.startsWith(`${provider}/`))) {
  const absolute = path.join(repo, file);
  if (!fs.existsSync(absolute)) continue; // deletion
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile()) { errors.push(`${file}: not a regular file`); continue; }
  if (stat.mode & 0o111) errors.push(`${file}: must not be executable`);
  if (stat.size > 2 * 1024 * 1024) errors.push(`${file}: larger than 2 MiB`);
  if (!allowedExtensions.has(path.extname(file).toLowerCase())) errors.push(`${file}: unexpected file type`);
  const bytes = fs.readFileSync(absolute);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { errors.push(`${file}: not UTF-8 text`); continue; }
  if (text.includes("\u0000")) errors.push(`${file}: contains NUL bytes`);
  if (file.endsWith(".json")) {
    try { JSON.parse(text); } catch (error) { errors.push(`${file}: invalid JSON (${error.message})`); }
  }
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) errors.push(`${file}: contains a possible ${label}`);
  }
  if (literalSecrets.some((secret) => text.includes(secret))) errors.push(`${file}: contains a configured secret value`);
}

// Release: VERSION names the planned release, and the registry agrees.
const versionText = fs.readFileSync(path.join(repo, provider, "VERSION"), "utf8");
const recorded = versionText.match(new RegExp(`^${versionField}\\s*=\\s*(.*?)\\s*$`, "m"))?.[1];
if (recorded !== expected) errors.push(`${provider}/VERSION ${versionField} is ${recorded}, expected ${expected}`);
errors.push(...validateManifest(repo, provider, { baseRef: "HEAD", requireEvidenceForChangedSurfaces: true }).errors);
if (fs.readFileSync(path.join(repo, "CATALOG.md"), "utf8") !== renderCatalog(repo)) {
  errors.push("CATALOG.md is not the generated catalog");
}

if (errors.length > 0) {
  for (const error of errors) console.log(`- ${error}`);
  process.exit(1);
}
console.log(`${provider} ${expected}: validation passed (${changed.length} changed paths)`);
