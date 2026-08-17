#!/usr/bin/env node

const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const readyPath = path.resolve(process.argv[2] || ".capture-scratch/ready-tools.json");
const evidencePath = path.resolve(process.argv[3] || "capture-output/evidence-index.json");
const manifestPath = path.resolve(process.argv[4] || ".capture-scratch/driver-input.json");
const knownDirectories = new Map([
  ["codex", "codex"],
  ["claude-code", "claude-code"],
  ["grok", "grok"],
  ["antigravity", "antigravity"],
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const contractFiles = [
  "Dockerfile",
  ".github/workflows/daily-refresh.yml",
  ".github/scripts/codex-orchestrator-prompt.md",
  ".github/scripts/codex-revise-prompt.md",
  ".github/scripts/review-refresh-prompt.md",
  ".github/scripts/review-result.schema.json",
  ".github/scripts/docker-entrypoint.sh",
  ".github/scripts/hash-candidate.sh",
  ".github/scripts/persist-credential.sh",
  ".github/scripts/run-codex-refresh.sh",
  ".github/scripts/seed-credentials.sh",
  ".github/scripts/validate-refresh.cjs",
  ".github/scripts/surface-registry.cjs",
  ".github/scripts/validate-surfaces.cjs",
  ".github/scripts/update-version-counts.cjs",
  ".github/scripts/update-surface-hashes.cjs",
  ".github/scripts/generate-catalog.cjs",
  ".github/scripts/validate-review.cjs",
  ".github/scripts/write-safe-retry.cjs",
  ".github/scripts/select-capture-results.cjs",
  ".github/scripts/compute-driver-input.cjs",
  ".github/scripts/prepare-driver-output.cjs",
  ".github/scripts/package-driver-output.sh",
  ".github/scripts/validate-publish-bundle.cjs",
];

function add(hash, label, value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  hash.update(label);
  hash.update("\0");
  hash.update(String(buffer.length));
  hash.update("\0");
  hash.update(buffer);
  hash.update("\0");
}

function newHash() {
  return crypto.createHash("sha256");
}

const readyPlan = JSON.parse(fs.readFileSync(readyPath, "utf8"));
if (!Array.isArray(readyPlan) || readyPlan.length < 1 || readyPlan.length > knownDirectories.size) {
  throw new Error("ready plan must contain one to four tools");
}
const seenTools = new Set();
const seenDirectories = new Set();
for (const entry of readyPlan) {
  if (
    !entry || typeof entry !== "object" || Array.isArray(entry) ||
    knownDirectories.get(entry.tool) !== entry.dir ||
    seenTools.has(entry.tool) || seenDirectories.has(entry.dir)
  ) {
    throw new Error(`ready plan contains an invalid or duplicate tool: ${JSON.stringify(entry)}`);
  }
  seenTools.add(entry.tool);
  seenDirectories.add(entry.dir);
}

const evidenceIndex = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
if (!Array.isArray(evidenceIndex)) throw new Error("evidence index must be an array");
const evidenceByTool = new Map(evidenceIndex.map((entry) => [entry?.tool, entry]));
if (evidenceByTool.size !== readyPlan.length || readyPlan.some((entry) => !evidenceByTool.has(entry.tool))) {
  throw new Error("evidence index must contain exactly one record for every ready tool");
}

const contractHash = newHash();
add(contractHash, "author-model", process.env.CODEX_REFRESH_MODEL || "");
add(contractHash, "author-effort", process.env.CODEX_REFRESH_REASONING_EFFORT || "");
add(contractHash, "review-model", process.env.CODEX_REVIEW_MODEL || "");
add(contractHash, "review-effort", process.env.CODEX_REVIEW_REASONING_EFFORT || "");
add(contractHash, "codex-cli-version", process.env.CODEX_DRIVER_VERSION || "");
for (const relative of contractFiles) add(contractHash, relative, fs.readFileSync(path.join(repoRoot, relative)));
const contractDigest = contractHash.digest("hex");

// Per-tool hashes prevent an unrelated provider's publication or evidence from
// rearming a reviewer-requested recapture for a stable tool.
const perTool = {};
for (const entry of readyPlan) {
  const tree = childProcess.execFileSync("git", ["rev-parse", `HEAD:${entry.dir}`], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new Error(`could not resolve baseline tree for ${entry.dir}`);
  const toolHash = newHash();
  add(toolHash, "driver-contract", contractDigest);
  add(toolHash, `baseline-tree:${entry.dir}`, tree);
  add(toolHash, "plan", canonical(entry));
  add(toolHash, "evidence", canonical(evidenceByTool.get(entry.tool)));
  perTool[entry.tool] = toolHash.digest("hex");
}
const globalHash = newHash();
add(globalHash, "driver-contract", contractDigest);
add(globalHash, "per-tool", canonical(perTool));
const inputHash = globalHash.digest("hex");
const bucketHours = Number(process.env.DRIVER_RETRY_BUCKET_HOURS || 24);
if (!Number.isInteger(bucketHours) || bucketHours < 1 || bucketHours > 168) {
  throw new Error("DRIVER_RETRY_BUCKET_HOURS must be an integer from 1 to 168");
}
const retryBucket = Math.floor(Date.now() / (bucketHours * 60 * 60 * 1000));

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify({
  schema_version: 1,
  input_hash: inputHash,
  retry_bucket: retryBucket,
  per_tool: perTool,
}, null, 2)}\n`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `input_hash=${inputHash}\nretry_bucket=${retryBucket}\n`);
}
console.log(`Codex driver input: ${inputHash}; retry bucket: ${retryBucket}`);
