#!/usr/bin/env node

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const planPath = path.resolve(process.argv[2] || ".capture-scratch/ready-tools.json");
const reviewPath = path.resolve(process.argv[3] || ".capture-scratch/review-result.json");
const summaryPath = path.resolve(process.argv[4] || ".capture-scratch/codex-summary.md");
const outputDir = path.resolve(process.argv[5] || "driver-output");
const captureRetriesPath = path.resolve(process.argv[6] || ".capture-scratch/capture-retries.json");
const driverInputPath = path.resolve(process.env.DRIVER_INPUT_MANIFEST || ".capture-scratch/driver-input.json");
const captureScratchDir = path.resolve(process.env.CAPTURE_SCRATCH_DIR || ".capture-scratch");
const validationEvidenceNames = [
  "artifact-source-map.json",
  "direct-source-manifest.json",
  "source-surface-inventory.json",
  "surface-observations.json",
];
// Keep this equal to the per-file bound enforced by prepare-capture-output.cjs
// and select-capture-results.cjs. The capture manifest supplies the exact size
// and digest for each file that crosses into the publication bundle.
const maxCaptureEvidenceFileBytes = 64 * 1024 * 1024;

const maxTextBytes = 256 * 1024;
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

function readSafeText(filePath, label, maxBytes = maxTextBytes) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes) {
    throw new Error(`${label} must be a nonempty regular file no larger than ${maxBytes} bytes`);
  }
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) throw new Error(`${label} contains a NUL byte`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  for (const [name, pattern] of secretPatterns) {
    if (pattern.test(text)) throw new Error(`${label} contains a possible ${name}`);
  }
  return text;
}

const plan = JSON.parse(readSafeText(planPath, "ready plan", 1024 * 1024));
const review = JSON.parse(readSafeText(reviewPath, "review result"));
const summary = readSafeText(summaryPath, "Codex summary");
const captureRetries = fs.existsSync(captureRetriesPath)
  ? JSON.parse(readSafeText(captureRetriesPath, "capture retry report", 1024 * 1024))
  : [];
const driverInput = JSON.parse(readSafeText(driverInputPath, "driver input manifest"));
if (
  !driverInput || driverInput.schema_version !== 1 ||
  typeof driverInput.input_hash !== "string" || !/^[0-9a-f]{64}$/.test(driverInput.input_hash) ||
  !driverInput.per_tool || typeof driverInput.per_tool !== "object" || Array.isArray(driverInput.per_tool)
) throw new Error("invalid driver input manifest");
if (!Array.isArray(plan) || !Array.isArray(review.tool_results)) throw new Error("invalid driver inputs");
const manifestTools = Object.keys(driverInput.per_tool).sort();
const planTools = plan.map((entry) => entry.tool).sort();
if (manifestTools.length !== planTools.length || manifestTools.some((tool, index) => tool !== planTools[index]) ||
    manifestTools.some((tool) => !/^[0-9a-f]{64}$/.test(driverInput.per_tool[tool]))) {
  throw new Error("driver input manifest tool hashes do not exactly match the ready plan");
}

const approved = [];
const approvedResults = [];
const retries = [];
// A held tool is recorded in the same report but never asks for a new capture:
// its evidence is already complete, so only a code or prompt change can advance it.
const held = [];
for (let index = 0; index < plan.length; index += 1) {
  const entry = plan[index];
  const result = review.tool_results[index];
  if (!result || result.tool !== entry.tool) throw new Error(`review order mismatch at ${entry.tool}`);
  if (result.outcome === "approve") {
    approved.push(entry);
    approvedResults.push(result);
  } else {
    const reviewInputHash = driverInput.per_tool[entry.tool];
    if (typeof reviewInputHash !== "string" || !/^[0-9a-f]{64}$/.test(reviewInputHash)) {
      throw new Error(`missing per-tool driver input hash for ${entry.tool}`);
    }
    const record = {
      tool: entry.tool,
      outcome: result.outcome,
      review_input_hash: reviewInputHash,
      issues: result.issues || [],
    };
    retries.push(record);
    if (result.outcome === "hold") held.push(record);
  }
}

function summarySections(text) {
  const sections = new Map();
  const lines = text.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      current = line.slice(3);
      sections.set(current, [line]);
    } else if (current) {
      sections.get(current).push(line);
    }
  }
  return sections;
}

const sections = summarySections(summary);
const approvedSummary = approved
  .map((entry) => (sections.get(entry.tool) || [`## ${entry.tool}`, `Captured ${entry.new_version}.`]).join("\n").trimEnd())
  .join("\n\n");
const publishReview = {
  decision: "approve",
  publish_safe: true,
  summary: `Approved ${approved.length} independently reviewed capture refresh(es).`,
  issues: (review.issues || []).filter((issue) => issue.severity !== "error"),
  tool_results: approvedResults,
};
const baseSha = childProcess.execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
if (!/^[0-9a-f]{40}$/.test(baseSha)) throw new Error("could not resolve an exact publish base SHA");

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
const validationEvidenceDir = path.join(outputDir, "validation-evidence");
fs.mkdirSync(validationEvidenceDir);
const validationEvidenceFiles = [];
for (const entry of approved) {
  const sourceDir = path.join(captureScratchDir, entry.tool, "evidence");
  const targetDir = path.join(validationEvidenceDir, entry.tool, "evidence");
  const sourceManifest = JSON.parse(readSafeText(
    path.join(sourceDir, "evidence-manifest.json"),
    `${entry.tool} evidence manifest`,
    4 * 1024 * 1024,
  ));
  if (sourceManifest?.tool !== entry.tool || !Array.isArray(sourceManifest.files)) {
    throw new Error(`${entry.tool} evidence manifest has an invalid schema`);
  }
  for (const name of validationEvidenceNames) {
    const sourcePath = path.join(sourceDir, name);
    if (!fs.existsSync(sourcePath)) continue;
    const records = sourceManifest.files.filter((record) => record?.path === name);
    if (
      records.length !== 1 || !Number.isSafeInteger(records[0].bytes) || records[0].bytes < 1 ||
      records[0].bytes > maxCaptureEvidenceFileBytes ||
      typeof records[0].sha256 !== "string" || !/^[0-9a-f]{64}$/.test(records[0].sha256)
    ) {
      throw new Error(`${entry.tool} ${name} has no valid capture-manifest record`);
    }
    const text = readSafeText(sourcePath, `${entry.tool} ${name}`, maxCaptureEvidenceFileBytes);
    const bytes = Buffer.from(text, "utf8");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== records[0].bytes || sha256 !== records[0].sha256) {
      throw new Error(`${entry.tool} ${name} does not match its capture-manifest record`);
    }
    try {
      JSON.parse(text);
    } catch (error) {
      throw new Error(`${entry.tool} ${name} must contain valid JSON: ${error.message}`);
    }
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, name), text);
    validationEvidenceFiles.push({ path: `${entry.tool}/evidence/${name}`, bytes: bytes.length, sha256 });
  }
}
fs.writeFileSync(
  path.join(validationEvidenceDir, "manifest.json"),
  `${JSON.stringify({
    schema_version: 1,
    files: validationEvidenceFiles.sort((left, right) => left.path.localeCompare(right.path)),
  }, null, 2)}\n`,
);
fs.writeFileSync(path.join(outputDir, "changed-tools.json"), `${JSON.stringify(approved, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "review-result.json"), `${JSON.stringify(publishReview, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "codex-summary.md"), `${approvedSummary}\n`);
fs.writeFileSync(path.join(outputDir, "retry-report.json"), `${JSON.stringify(retries, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "capture-retries.json"), `${JSON.stringify(captureRetries, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, "base-sha.txt"), `${baseSha}\n`);
fs.writeFileSync(
  path.join(outputDir, "result.json"),
  `${JSON.stringify({
    has_publishable: approved.length > 0,
    base_sha: baseSha,
    approved_tools: approved.map((entry) => entry.tool),
    retry_tools: [...new Set([
      ...retries.filter((entry) => entry.outcome !== "hold").map((entry) => entry.tool),
      ...captureRetries.map((entry) => entry.tool),
    ])],
  }, null, 2)}\n`,
);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_publishable=${approved.length > 0}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `approved_count=${approved.length}\n`);
}
console.log(
  `Driver output: ${approved.length} approved, ` +
  `${retries.length - held.length + captureRetries.length} deferred, ${held.length} held.`,
);
