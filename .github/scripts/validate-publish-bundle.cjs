#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const bundleDir = path.resolve(process.argv[2] || "driver-output");
const knownDirectories = new Map([
  ["codex", "codex"],
  ["claude-code", "claude-code"],
  ["grok", "grok"],
  ["antigravity", "antigravity"],
  ["qwen-code", "qwen-code"],
]);
const validationEvidenceNames = new Set([
  "artifact-source-map.json",
  "direct-source-manifest.json",
  "source-surface-inventory.json",
  "surface-observations.json",
]);

function readJson(name) {
  return JSON.parse(readSafeText(name, 1024 * 1024));
}

const secretPatterns = [
  ["private key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["OpenAI-style API key", /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["Google OAuth token", /\bya29\.[A-Za-z0-9_-]{20,}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["authorization header", /\b(?:authorization|proxy-authorization)\s*[:=]\s*["']?(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{20,}/i],
  ["credential JSON value", /["'](?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret)["']\s*:\s*["'](?!\*{3}|<|example)[^"']{12,}["']/i],
];

function readSafeText(name, maxBytes = 256 * 1024) {
  const file = path.join(bundleDir, name);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes) {
    throw new Error(`${name} must be a nonempty regular file no larger than ${maxBytes} bytes`);
  }
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) throw new Error(`${name} contains a NUL byte`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) throw new Error(`${name} contains a possible ${label}`);
  }
  return text;
}

const expectedEntries = [
  "base-sha.txt", "candidate.patch", "capture-retries.json", "changed-tools.json",
  "codex-summary.md", "result.json", "retry-report.json", "review-result.json", "validation-evidence",
];
const bundleStat = fs.lstatSync(bundleDir);
if (!bundleStat.isDirectory() || bundleStat.isSymbolicLink()) throw new Error("driver bundle must be a real directory");
const actualEntries = fs.readdirSync(bundleDir).sort();
if (actualEntries.length !== expectedEntries.length || actualEntries.some((name, index) => name !== expectedEntries[index])) {
  throw new Error(`driver bundle must contain exactly: ${expectedEntries.join(", ")}`);
}

const changed = readJson("changed-tools.json");
const result = readJson("result.json");
const review = readJson("review-result.json");
const patchPath = path.join(bundleDir, "candidate.patch");
const patchText = readSafeText("candidate.patch", 100 * 1024 * 1024);
const baseSha = readSafeText("base-sha.txt", 128).trim();
const currentSha = childProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/.test(baseSha) || result.base_sha !== baseSha) {
  throw new Error("publish bundle has an invalid or inconsistent base SHA");
}
if (currentSha !== baseSha) {
  throw new Error(`publish base moved: reviewed ${baseSha}, current checkout ${currentSha}`);
}
readSafeText("codex-summary.md");
readSafeText("review-result.json");
readSafeText("retry-report.json");
readSafeText("capture-retries.json", 1024 * 1024);
if (!Array.isArray(changed) || changed.length < 1 || changed.length > knownDirectories.size) {
  throw new Error("publish bundle must contain one to four changed tools");
}

const tools = new Set();
const dirs = new Set();
for (const entry of changed) {
  if (!entry || knownDirectories.get(entry.tool) !== entry.dir) {
    throw new Error(`unexpected tool/directory mapping: ${JSON.stringify(entry)}`);
  }
  if (tools.has(entry.tool) || dirs.has(entry.dir)) throw new Error("duplicate tool or directory in publish bundle");
  if (typeof entry.new_version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][A-Za-z0-9.]+)?$/.test(entry.new_version)) {
    throw new Error(`${entry.tool}: invalid target version`);
  }
  if (typeof entry.plan_hash !== "string" || !/^[0-9a-f]{64}$/.test(entry.plan_hash)) {
    throw new Error(`${entry.tool}: invalid plan hash`);
  }
  tools.add(entry.tool);
  dirs.add(entry.dir);
}

const validationEvidenceDir = path.join(bundleDir, "validation-evidence");
const validationEvidenceStat = fs.lstatSync(validationEvidenceDir);
if (!validationEvidenceStat.isDirectory() || validationEvidenceStat.isSymbolicLink()) {
  throw new Error("validation-evidence must be a real directory");
}
const validationEvidenceManifest = readJson("validation-evidence/manifest.json");
if (
  !validationEvidenceManifest || validationEvidenceManifest.schema_version !== 1 ||
  Object.keys(validationEvidenceManifest).sort().join(",") !== "files,schema_version" ||
  !Array.isArray(validationEvidenceManifest.files) ||
  validationEvidenceManifest.files.some((name) => typeof name !== "string")
) {
  throw new Error("validation evidence manifest has an invalid schema");
}
const actualValidationEvidenceFiles = [];
for (const tool of fs.readdirSync(validationEvidenceDir).filter((name) => name !== "manifest.json")) {
  if (!tools.has(tool)) throw new Error(`validation evidence belongs to an unapproved tool: ${tool}`);
  const toolDir = path.join(validationEvidenceDir, tool);
  const toolStat = fs.lstatSync(toolDir);
  if (!toolStat.isDirectory() || toolStat.isSymbolicLink()) {
    throw new Error(`validation-evidence/${tool} must be a real directory`);
  }
  const toolEntries = fs.readdirSync(toolDir);
  if (toolEntries.length !== 1 || toolEntries[0] !== "evidence") {
    throw new Error(`validation-evidence/${tool} must contain only evidence`);
  }
  const evidenceDir = path.join(toolDir, "evidence");
  const evidenceStat = fs.lstatSync(evidenceDir);
  if (!evidenceStat.isDirectory() || evidenceStat.isSymbolicLink()) {
    throw new Error(`validation-evidence/${tool}/evidence must be a real directory`);
  }
  const evidenceFiles = fs.readdirSync(evidenceDir);
  if (evidenceFiles.length === 0) throw new Error(`validation-evidence/${tool}/evidence is empty`);
  for (const name of evidenceFiles) {
    if (!validationEvidenceNames.has(name)) {
      throw new Error(`validation evidence is not allowlisted: ${tool}/evidence/${name}`);
    }
    const relative = `validation-evidence/${tool}/evidence/${name}`;
    const text = readSafeText(relative, 1024 * 1024);
    try {
      JSON.parse(text);
    } catch (error) {
      throw new Error(`${relative} must contain valid JSON: ${error.message}`);
    }
    actualValidationEvidenceFiles.push(`${tool}/evidence/${name}`);
  }
}
actualValidationEvidenceFiles.sort();
if (
  actualValidationEvidenceFiles.length !== validationEvidenceManifest.files.length ||
  actualValidationEvidenceFiles.some((name, index) => name !== validationEvidenceManifest.files[index])
) {
  throw new Error("validation evidence files do not match manifest.json");
}

if (result.has_publishable !== true || !Array.isArray(result.approved_tools)) {
  throw new Error("publish result is not marked publishable");
}
if (result.approved_tools.length !== tools.size || result.approved_tools.some((tool) => !tools.has(tool))) {
  throw new Error("approved tool list does not match changed-tools.json");
}
if (review.decision !== "approve" || review.publish_safe !== true || !Array.isArray(review.tool_results)) {
  throw new Error("review result does not approve publication");
}
if (
  review.tool_results.length !== changed.length ||
  review.tool_results.some((item, index) =>
    item.tool !== changed[index].tool || item.outcome !== "approve" || item.pii_removed !== true)
) {
  throw new Error("review tool results do not exactly approve the publish plan and attest PII removal");
}

const patchStat = fs.lstatSync(patchPath);
if (!patchStat.isFile() || patchStat.isSymbolicLink() || patchStat.size < 1 || patchStat.size > 100 * 1024 * 1024) {
  throw new Error("candidate patch must be a nonempty regular file no larger than 100 MiB");
}
if (/^(?:new|old) mode 1007[0-7][0-7]$/m.test(patchText)) {
  throw new Error("candidate patch may not create or preserve executable artifact files");
}
childProcess.execFileSync("git", ["apply", "--check", "--", patchPath], { cwd: repoRoot, stdio: "pipe" });
const numstat = childProcess.execFileSync("git", ["apply", "--numstat", "-z", "--", patchPath], {
  cwd: repoRoot,
  encoding: "buffer",
});
const touchedDirs = new Set();
const records = numstat.toString("utf8").split("\0").filter(Boolean);
if (records.length === 0) throw new Error("candidate patch has no file changes");
for (const record of records) {
  const firstTab = record.indexOf("\t");
  const secondTab = record.indexOf("\t", firstTab + 1);
  if (firstTab < 1 || secondTab < firstTab + 2) throw new Error("could not parse candidate patch path list");
  const relative = record.slice(secondTab + 1);
  if (
    relative === "" || relative.includes("\\") || path.posix.isAbsolute(relative) ||
    path.posix.normalize(relative) !== relative || relative.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`unsafe candidate patch path: ${JSON.stringify(relative)}`);
  }
  if (relative === "CATALOG.md") continue;
  const owner = [...dirs].find((dir) => relative.startsWith(`${dir}/`));
  if (!owner) throw new Error(`candidate patch escapes approved tool directories: ${relative}`);
  const local = relative.slice(owner.length + 1);
  const allowed = local === "VERSION" || local === "SURFACES.json" ||
    /^prompts\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(local) ||
    /^tools\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(local) ||
    /^misc\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:json|md|txt|xml|VERSION)$/.test(local);
  if (!allowed) {
    throw new Error(`candidate patch path is not an allowlisted normalized artifact: ${relative}`);
  }
  touchedDirs.add(owner);
}
for (const dir of dirs) {
  if (!touchedDirs.has(dir)) throw new Error(`candidate patch does not update approved directory ${dir}`);
}

console.log(`Publish bundle path gate passed for: ${[...tools].join(", ")}`);
