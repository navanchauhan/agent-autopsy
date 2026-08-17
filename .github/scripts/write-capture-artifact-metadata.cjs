#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const [bundleArg, tool, planHash, runId, runAttemptArg, source, forcedArg, degradedArg, bucket] = process.argv.slice(2);
const tools = new Set(["codex", "claude-code", "grok", "antigravity", "qwen-code"]);
const sources = new Set(["fresh", "positive_cache", "retry_cache"]);
const metadataName = "workflow-run.json";

function fail(message) {
  console.error(message);
  process.exit(2);
}

if (!bundleArg || !tools.has(tool) || !/^[0-9a-f]{64}$/.test(planHash || "") ||
    !/^[1-9][0-9]*$/.test(runId || "") || !/^[1-9][0-9]*$/.test(runAttemptArg || "") ||
    !sources.has(source) || !["true", "false"].includes(forcedArg) ||
    !["true", "false"].includes(degradedArg) || !/^[0-9]{8}$/.test(bucket || "")) {
  fail("Usage: write-capture-artifact-metadata.cjs <bundle> <tool> <plan-hash> <run-id> <attempt> <source> <forced> <security-degraded> <YYYYMMDD>");
}

const bundle = path.resolve(bundleArg);
const runAttempt = Number(runAttemptArg);
if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) fail("run attempt must be a positive safe integer");
const metadataPath = path.join(bundle, metadataName);

function requireDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("capture bundle must be a real directory");
}

function regularFiles(directory, base = directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === metadataName && directory === base) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(base, absolute).replaceAll("\\", "/");
    if (entry.isSymbolicLink()) fail(`capture bundle contains a symbolic link: ${relative}`);
    if (entry.isDirectory()) found.push(...regularFiles(absolute, base));
    else if (entry.isFile()) found.push({ absolute, relative });
    else fail(`capture bundle contains an unsupported entry: ${relative}`);
  }
  return found.sort((left, right) => left.relative.localeCompare(right.relative));
}

function bundleHash(directory) {
  const digest = crypto.createHash("sha256");
  for (const file of regularFiles(directory)) {
    const bytes = fs.readFileSync(file.absolute);
    const fileHash = crypto.createHash("sha256").update(bytes).digest("hex");
    digest.update(file.relative, "utf8");
    digest.update("\0");
    digest.update(String(bytes.length), "utf8");
    digest.update("\0");
    digest.update(fileHash, "ascii");
    digest.update("\n");
  }
  return digest.digest("hex");
}

requireDirectory(bundle);
const resultPath = path.join(bundle, "result.json");
const resultStat = fs.lstatSync(resultPath);
if (!resultStat.isFile() || resultStat.isSymbolicLink() || resultStat.size < 1 || resultStat.size > 65536) {
  fail("capture result must be a small regular file");
}
const resultBytes = fs.readFileSync(resultPath);
if (resultBytes.includes(0)) fail("capture result contains a NUL byte");
let result;
try {
  result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(resultBytes));
} catch (error) {
  fail(`capture result is not valid UTF-8 JSON: ${error.message}`);
}
if (result.tool !== tool || result.plan_hash !== planHash || !["captured", "retry_capture"].includes(result.status)) {
  fail("capture result identity or trusted status does not match artifact metadata");
}
if (degradedArg === "true" && result.status !== "retry_capture") {
  fail("a security-degraded artifact must contain only a trusted retry result");
}
if ((source === "positive_cache" && result.status !== "captured") ||
    (source === "retry_cache" && result.status !== "retry_capture") ||
    (forcedArg === "true" && source !== "fresh") ||
    (degradedArg === "true" && source !== "fresh")) {
  fail("capture source, force, security, and status metadata are inconsistent");
}

if (fs.existsSync(metadataPath)) {
  const metadataStat = fs.lstatSync(metadataPath);
  if (metadataStat.isDirectory()) fail("reserved workflow metadata path is a directory");
  fs.rmSync(metadataPath, { force: true });
}

const metadata = {
  schema_version: 1,
  tool,
  plan_hash: planHash,
  run_id: runId,
  run_attempt: runAttempt,
  capture_bucket: bucket,
  source,
  forced: forcedArg === "true",
  status: result.status,
  security_degraded: degradedArg === "true",
  bundle_sha256: bundleHash(bundle),
};
const temporary = path.join(bundle, `.workflow-run-${process.pid}.tmp`);
fs.writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600, flag: "wx" });
fs.renameSync(temporary, metadataPath);
console.log(`${tool}: wrote trusted capture artifact metadata for attempt ${runAttempt}`);
