#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const [planArg, stateArg, downloadsArg, outputArg, currentRunId, currentAttemptArg, forceArg = "false"] = process.argv.slice(2);
const knownTools = new Set(["codex", "claude-code", "grok", "antigravity"]);
const metadataName = "workflow-run.json";

function fail(message) {
  throw new Error(message);
}

function readJson(file, label, maxBytes = 2 * 1024 * 1024) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes) fail(`${label} must be a bounded regular file`);
  const bytes = fs.readFileSync(file);
  if (bytes.includes(0)) fail(`${label} contains a NUL byte`);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function walk(directory, base = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === metadataName && directory === base) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(base, absolute).replaceAll("\\", "/");
    if (entry.isSymbolicLink()) fail(`artifact contains a symbolic link: ${relative}`);
    if (entry.isDirectory()) files.push(...walk(absolute, base));
    else if (entry.isFile()) files.push({ absolute, relative });
    else fail(`artifact contains an unsupported entry: ${relative}`);
  }
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

function bundleHash(directory) {
  const digest = crypto.createHash("sha256");
  for (const file of walk(directory)) {
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

function validateState(raw) {
  if (!exactKeys(raw, ["schema_version", "tools"]) || raw.schema_version !== 1 ||
      !raw.tools || typeof raw.tools !== "object" || Array.isArray(raw.tools)) fail("invalid recapture state root");
  for (const [tool, entry] of Object.entries(raw.tools)) {
    if (!knownTools.has(tool) || !exactKeys(entry, [
      "plan_hash", "state", "request_after_run_id", "request_after_run_attempt",
      "last_fresh_bucket", "last_reviewer_input_hash", "reason",
    ]) || !/^[0-9a-f]{64}$/.test(entry.plan_hash) ||
        !["clear", "force_once", "suppress_positive"].includes(entry.state) ||
        !(entry.request_after_run_id === null || /^[1-9][0-9]*$/.test(entry.request_after_run_id)) ||
        !(entry.request_after_run_attempt === null || Number.isSafeInteger(entry.request_after_run_attempt) && entry.request_after_run_attempt > 0) ||
        !(entry.last_fresh_bucket === null || /^[0-9]{8}$/.test(entry.last_fresh_bucket)) ||
        !(entry.last_reviewer_input_hash === null || /^[0-9a-f]{64}$/.test(entry.last_reviewer_input_hash)) ||
        !(entry.reason === null || ["reviewer", "security", "manual", "capture_retry"].includes(entry.reason)) ||
        (entry.state === "clear" && (entry.request_after_run_id !== null || entry.request_after_run_attempt !== null || entry.reason !== null)) ||
        (entry.state === "force_once" && (entry.request_after_run_id === null || entry.request_after_run_attempt === null ||
          !["reviewer", "security", "manual"].includes(entry.reason))) ||
        (entry.state === "suppress_positive" && (entry.request_after_run_id !== null || entry.request_after_run_attempt !== null ||
          !["reviewer", "security", "capture_retry"].includes(entry.reason)))) {
      fail(`invalid recapture state for ${tool}`);
    }
  }
  return raw;
}

function validMetadata(value, tool, planHash) {
  return exactKeys(value, [
    "schema_version", "tool", "plan_hash", "run_id", "run_attempt", "capture_bucket",
    "source", "forced", "status", "security_degraded", "bundle_sha256",
  ]) && value.schema_version === 1 && value.tool === tool && value.plan_hash === planHash &&
    /^[1-9][0-9]*$/.test(value.run_id) && Number.isSafeInteger(value.run_attempt) && value.run_attempt > 0 &&
    /^[0-9]{8}$/.test(value.capture_bucket) && ["fresh", "positive_cache", "retry_cache"].includes(value.source) &&
    typeof value.forced === "boolean" && ["captured", "retry_capture"].includes(value.status) &&
    typeof value.security_degraded === "boolean" && /^[0-9a-f]{64}$/.test(value.bundle_sha256) &&
    (!value.security_degraded || value.status === "retry_capture" && value.source === "fresh") &&
    (value.source !== "positive_cache" || value.status === "captured") &&
    (value.source !== "retry_cache" || value.status === "retry_capture") &&
    (!value.forced || value.source === "fresh");
}

function isAfterRequest(metadata, entry) {
  if (entry.request_after_run_id === null || entry.request_after_run_attempt === null) return false;
  const candidateRun = BigInt(metadata.run_id);
  const requestRun = BigInt(entry.request_after_run_id);
  return candidateRun > requestRun || (candidateRun === requestRun && metadata.run_attempt > entry.request_after_run_attempt);
}

function eligible(metadata, state, forced) {
  if (forced && (!metadata.forced || metadata.source !== "fresh")) return false;
  if (!state || state.state === "clear") return true;
  if (state.state === "suppress_positive") return metadata.source !== "positive_cache";
  return metadata.source === "fresh" && isAfterRequest(metadata, state);
}

function copyBundle(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const file of walk(source)) {
    const target = path.join(destination, ...file.relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file.absolute, target, fs.constants.COPYFILE_EXCL);
  }
}

if (!planArg || !stateArg || !downloadsArg || !outputArg || !/^[1-9][0-9]*$/.test(currentRunId || "") ||
    !/^[1-9][0-9]*$/.test(currentAttemptArg || "") ||
    !["true", "false"].includes(forceArg)) {
  fail("Usage: select-capture-artifacts.cjs <plan> <state> <downloads> <output> <run-id> <current-attempt> [force]");
}
const plan = readJson(path.resolve(planArg), "capture plan");
if (!Array.isArray(plan) || plan.length > knownTools.size) fail("capture plan must be a bounded array");
const byTool = new Map();
for (const entry of plan) {
  if (!entry || !knownTools.has(entry.tool) || !/^[0-9a-f]{64}$/.test(entry.plan_hash || "") || byTool.has(entry.tool)) {
    fail("capture plan contains an invalid or duplicate tool");
  }
  byTool.set(entry.tool, entry);
}
const states = validateState(readJson(path.resolve(stateArg), "recapture state", 256 * 1024));
const downloads = path.resolve(downloadsArg);
const output = path.resolve(outputArg);
const forced = forceArg === "true";
const currentAttempt = Number(currentAttemptArg);
if (!Number.isSafeInteger(currentAttempt) || currentAttempt < 1) fail("current attempt must be a positive safe integer");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const selected = new Map();
if (fs.existsSync(downloads)) {
  const downloadsStat = fs.lstatSync(downloads);
  if (!downloadsStat.isDirectory() || downloadsStat.isSymbolicLink()) fail("artifact download root must be a real directory");
  for (const directoryName of fs.readdirSync(downloads).sort()) {
    const match = /^capture-bundle-(codex|claude-code|grok|antigravity)-attempt-([1-9][0-9]*)$/.exec(directoryName);
    if (!match) fail(`unexpected capture artifact directory: ${directoryName}`);
    const [, tool, attemptText] = match;
    const planEntry = byTool.get(tool);
    if (!planEntry) continue;
    const directory = path.join(downloads, directoryName);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`capture artifact is not a real directory: ${directoryName}`);
    const metadata = readJson(path.join(directory, metadataName), `${tool} artifact metadata`, 64 * 1024);
    if (!validMetadata(metadata, tool, planEntry.plan_hash) || metadata.run_attempt !== Number(attemptText) ||
        metadata.run_attempt > currentAttempt ||
        metadata.run_id !== currentRunId || bundleHash(directory) !== metadata.bundle_sha256) {
      fail(`capture artifact metadata or digest is invalid: ${directoryName}`);
    }
    const result = readJson(path.join(directory, "result.json"), `${tool} capture result`, 64 * 1024);
    if (result.tool !== tool || result.plan_hash !== planEntry.plan_hash || result.status !== metadata.status) {
      fail(`capture artifact result does not match metadata: ${directoryName}`);
    }
    const state = states.tools[tool]?.plan_hash === planEntry.plan_hash ? states.tools[tool] : null;
    if (!eligible(metadata, state, forced)) continue;
    const previous = selected.get(tool);
    if (!previous || metadata.run_attempt > previous.metadata.run_attempt) {
      selected.set(tool, { directory, metadata });
    } else if (metadata.run_attempt === previous.metadata.run_attempt) {
      fail(`duplicate capture artifact attempt for ${tool}`);
    }
  }
}

for (const [tool, choice] of selected) copyBundle(choice.directory, path.join(output, tool));
console.log(`Selected ${selected.size} rerun-safe capture artifact(s).`);
for (const [tool, choice] of selected) {
  console.log(`${tool}: attempt ${choice.metadata.run_attempt}, source ${choice.metadata.source}, status ${choice.metadata.status}`);
}
