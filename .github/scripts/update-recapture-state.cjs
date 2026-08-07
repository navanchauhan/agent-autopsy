#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const [
  priorStateArg,
  planArg,
  captureDownloadsArg,
  driverDownloadsArg,
  currentRunId,
  currentAttemptArg,
  currentBucket,
  outputArg,
] = process.argv.slice(2);

const metadataName = "workflow-run.json";
const knownDirectories = new Map([
  ["codex", "codex"],
  ["claude-code", "claude-code"],
  ["grok", "grok"],
  ["antigravity", "antigravity"],
]);
const captureSources = new Set(["fresh", "positive_cache", "retry_cache"]);
const driverSources = new Set(["fresh", "positive_cache", "retry_cache", "capture_only"]);
const states = new Set(["clear", "force_once", "suppress_positive"]);
const reasons = new Set(["reviewer", "security", "manual", "capture_retry"]);

function fail(message) {
  throw new Error(message);
}

function exactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function readJson(file, label, maxBytes = 2 * 1024 * 1024) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    fail(`${label} is unavailable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes) {
    fail(`${label} must be a nonempty bounded regular file`);
  }
  const bytes = fs.readFileSync(file);
  if (bytes.includes(0)) fail(`${label} contains a NUL byte`);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail(`${label} is not valid UTF-8: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function positiveRunId(value) {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}

function positiveAttempt(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validBucket(value) {
  return typeof value === "string" && /^[0-9]{8}$/.test(value);
}

function validHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validateState(raw) {
  if (
    !exactKeys(raw, ["schema_version", "tools"]) ||
    raw.schema_version !== 1 ||
    !raw.tools ||
    typeof raw.tools !== "object" ||
    Array.isArray(raw.tools)
  ) {
    fail("recapture state root must contain exactly schema_version=1 and a tools object");
  }

  for (const [tool, entry] of Object.entries(raw.tools)) {
    if (!knownDirectories.has(tool)) fail(`recapture state contains an unsupported tool: ${tool}`);
    if (!exactKeys(entry, [
      "plan_hash",
      "state",
      "request_after_run_id",
      "request_after_run_attempt",
      "last_fresh_bucket",
      "last_reviewer_input_hash",
      "reason",
    ])) {
      fail(`recapture state for ${tool} has an invalid schema`);
    }
    if (!validHash(entry.plan_hash) || !states.has(entry.state)) {
      fail(`recapture state for ${tool} has an invalid plan hash or state`);
    }
    const requestIsNull = entry.request_after_run_id === null && entry.request_after_run_attempt === null;
    const requestIsSet = positiveRunId(entry.request_after_run_id) && positiveAttempt(entry.request_after_run_attempt);
    if (!requestIsNull && !requestIsSet) fail(`recapture state for ${tool} has a partial request marker`);
    if (entry.state === "force_once" && !requestIsSet) {
      fail(`force_once state for ${tool} requires a complete request marker`);
    }
    if (entry.state !== "force_once" && !requestIsNull) {
      fail(`${entry.state} state for ${tool} may not retain a request marker`);
    }
    if (!(entry.last_fresh_bucket === null || validBucket(entry.last_fresh_bucket))) {
      fail(`recapture state for ${tool} has an invalid fresh bucket`);
    }
    if (!(entry.last_reviewer_input_hash === null || validHash(entry.last_reviewer_input_hash))) {
      fail(`recapture state for ${tool} has an invalid reviewer input hash`);
    }
    if (!(entry.reason === null || reasons.has(entry.reason))) {
      fail(`recapture state for ${tool} has an invalid reason`);
    }
    if (entry.state === "clear" && entry.reason !== null) fail(`clear state for ${tool} must have a null reason`);
    if (entry.state === "force_once" && !["reviewer", "security", "manual"].includes(entry.reason)) {
      fail(`force_once state for ${tool} has an invalid reason`);
    }
    if (entry.state === "suppress_positive" && !["reviewer", "security", "capture_retry"].includes(entry.reason)) {
      fail(`suppress_positive state for ${tool} has an invalid reason`);
    }
  }
  return raw;
}

function validatePlan(raw) {
  if (!Array.isArray(raw) || raw.length > knownDirectories.size) {
    fail("capture plan must be an array containing at most four tools");
  }
  const byTool = new Map();
  for (const entry of raw) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      !knownDirectories.has(entry.tool) ||
      knownDirectories.get(entry.tool) !== entry.dir ||
      !validHash(entry.plan_hash) ||
      byTool.has(entry.tool)
    ) {
      fail(`capture plan contains an invalid or duplicate entry: ${JSON.stringify(entry)}`);
    }
    byTool.set(entry.tool, entry);
  }
  return byTool;
}

function walk(directory, base = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (directory === base && entry.name === metadataName) continue;
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

function requireArtifactDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real directory`);
}

function validateEventTiming(metadata, directoryAttempt, label) {
  if (metadata.run_id !== currentRunId || metadata.run_attempt !== directoryAttempt) {
    fail(`${label} run identity does not match its artifact directory or current run`);
  }
  if (metadata.run_attempt > currentAttempt) fail(`${label} comes from a future workflow attempt`);
  if (metadata.capture_bucket > currentBucket) fail(`${label} has a future capture bucket`);
  if (metadata.run_attempt === currentAttempt && metadata.capture_bucket !== currentBucket) {
    fail(`${label} bucket does not match the current workflow attempt`);
  }
}

function validateCaptureMetadata(value, tool, planHash) {
  return exactKeys(value, [
    "schema_version",
    "tool",
    "plan_hash",
    "run_id",
    "run_attempt",
    "capture_bucket",
    "source",
    "forced",
    "status",
    "security_degraded",
    "bundle_sha256",
  ]) &&
    value.schema_version === 1 &&
    value.tool === tool &&
    value.plan_hash === planHash &&
    positiveRunId(value.run_id) &&
    positiveAttempt(value.run_attempt) &&
    validBucket(value.capture_bucket) &&
    captureSources.has(value.source) &&
    typeof value.forced === "boolean" &&
    ["captured", "retry_capture"].includes(value.status) &&
    typeof value.security_degraded === "boolean" &&
    validHash(value.bundle_sha256) &&
    (!value.security_degraded || value.status === "retry_capture");
}

function validateDriverMetadata(value) {
  if (!exactKeys(value, [
    "schema_version",
    "input_hash",
    "run_id",
    "run_attempt",
    "capture_bucket",
    "source",
    "bundle_sha256",
  ])) return false;
  if (
    value.schema_version !== 1 ||
    !positiveRunId(value.run_id) ||
    !positiveAttempt(value.run_attempt) ||
    !validBucket(value.capture_bucket) ||
    !driverSources.has(value.source) ||
    !validHash(value.bundle_sha256)
  ) return false;
  return value.source === "capture_only" ? value.input_hash === null : validHash(value.input_hash);
}

function artifactDirectories(rootArg, expression, label) {
  const root = path.resolve(rootArg);
  if (!fs.existsSync(root)) return [];
  requireArtifactDirectory(root, `${label} root`);
  const directories = [];
  for (const name of fs.readdirSync(root).sort()) {
    const match = expression.exec(name);
    if (!match) fail(`unexpected ${label} artifact directory: ${name}`);
    const directory = path.join(root, name);
    requireArtifactDirectory(directory, `${label} artifact ${name}`);
    directories.push({ directory, name, match });
  }
  return directories;
}

function captureEvents(planByTool) {
  const events = [];
  const seen = new Set();
  for (const artifact of artifactDirectories(
    captureDownloadsArg,
    /^capture-bundle-(codex|claude-code|grok|antigravity)-attempt-([1-9][0-9]*)$/,
    "capture",
  )) {
    const [, tool, attemptText] = artifact.match;
    const plan = planByTool.get(tool);
    if (!plan) fail(`capture artifact exists for an unplanned tool: ${tool}`);
    const attempt = Number(attemptText);
    if (!positiveAttempt(attempt)) fail(`capture artifact has an unsafe attempt number: ${artifact.name}`);
    const identity = `${tool}\0${attempt}`;
    if (seen.has(identity)) fail(`duplicate capture artifact for ${tool} attempt ${attempt}`);
    seen.add(identity);

    const metadata = readJson(path.join(artifact.directory, metadataName), `${tool} capture metadata`, 64 * 1024);
    if (!validateCaptureMetadata(metadata, tool, plan.plan_hash)) {
      fail(`capture artifact metadata has an invalid schema or plan identity: ${artifact.name}`);
    }
    validateEventTiming(metadata, attempt, `${tool} capture artifact`);
    if (bundleHash(artifact.directory) !== metadata.bundle_sha256) {
      fail(`capture artifact digest is invalid: ${artifact.name}`);
    }
    const result = readJson(path.join(artifact.directory, "result.json"), `${tool} capture result`, 64 * 1024);
    if (
      !exactKeys(result, [
        "tool",
        "target_version",
        "status",
        "message",
        "capture_contract_hash",
        "plan_hash",
      ]) ||
      result.tool !== tool ||
      result.plan_hash !== plan.plan_hash ||
      result.status !== metadata.status ||
      typeof result.message !== "string" ||
      result.message.length > 4096 ||
      (typeof plan.new_version === "string" && result.target_version !== plan.new_version) ||
      (typeof plan.capture_contract_hash === "string" && result.capture_contract_hash !== plan.capture_contract_hash)
    ) {
      fail(`capture result does not match trusted metadata: ${artifact.name}`);
    }
    if (!metadata.security_degraded) {
      if (metadata.source === "positive_cache" && metadata.status !== "captured") {
        fail(`positive capture cache may contain only a captured result: ${artifact.name}`);
      }
      if (metadata.source === "retry_cache" && metadata.status !== "retry_capture") {
        fail(`retry capture cache may contain only a retry result: ${artifact.name}`);
      }
    }
    if (metadata.security_degraded && metadata.source !== "fresh") {
      fail(`a security-degraded capture must be fresh: ${artifact.name}`);
    }
    if (metadata.forced && metadata.source !== "fresh") {
      fail(`a manually forced capture must be fresh: ${artifact.name}`);
    }
    events.push({ kind: "capture", order: 0, tool, attempt, metadata });
  }
  return events;
}

function stringArray(value, label, planByTool) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const seen = new Set();
  for (const tool of value) {
    if (typeof tool !== "string" || !planByTool.has(tool) || seen.has(tool)) {
      fail(`${label} contains an invalid, duplicate, or unplanned tool`);
    }
    seen.add(tool);
  }
  return value;
}

function exactRootEntries(directory, expected, label) {
  const actual = fs.readdirSync(directory).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((name, index) => name !== wanted[index])) {
    fail(`${label} must contain exactly: ${wanted.join(", ")}`);
  }
}

function captureRetryPartition(directory, planByTool, label) {
  const raw = readJson(path.join(directory, "capture-retries.json"), `${label} capture retries`, 1024 * 1024);
  if (!Array.isArray(raw)) fail(`${label} capture retries must be an array`);
  const allowedStatuses = new Set([
    "retry_capture", "security_error", "missing_result", "stale_result",
    "invalid_evidence", "invalid_bundle", "source_sync_error",
  ]);
  const tools = new Set();
  for (const entry of raw) {
    const plan = planByTool.get(entry?.tool);
    if (!plan || entry.plan_hash !== plan.plan_hash || tools.has(entry.tool) ||
        !allowedStatuses.has(entry.status) || typeof entry.message !== "string" || entry.message.length > 4096) {
      fail(`${label} capture retries contain an invalid, duplicate, or stale entry`);
    }
    tools.add(entry.tool);
  }
  return tools;
}

function driverEvents(planByTool) {
  const events = [];
  const seenAttempts = new Set();
  for (const artifact of artifactDirectories(
    driverDownloadsArg,
    /^driver-output-attempt-([1-9][0-9]*)$/,
    "driver",
  )) {
    const attempt = Number(artifact.match[1]);
    if (!positiveAttempt(attempt)) fail(`driver artifact has an unsafe attempt number: ${artifact.name}`);
    if (seenAttempts.has(attempt)) fail(`duplicate driver artifact for attempt ${attempt}`);
    seenAttempts.add(attempt);

    const metadata = readJson(path.join(artifact.directory, metadataName), "driver artifact metadata", 64 * 1024);
    if (!validateDriverMetadata(metadata)) fail(`driver artifact metadata is invalid: ${artifact.name}`);
    validateEventTiming(metadata, attempt, "driver artifact");
    if (bundleHash(artifact.directory) !== metadata.bundle_sha256) {
      fail(`driver artifact digest is invalid: ${artifact.name}`);
    }

    const result = readJson(path.join(artifact.directory, "result.json"), "driver result", 1024 * 1024);
    const captureOnly = metadata.source === "capture_only";
    const resultKeys = captureOnly
      ? ["has_publishable", "approved_tools", "retry_tools"]
      : ["has_publishable", "base_sha", "approved_tools", "retry_tools"];
    if (!exactKeys(result, resultKeys) || typeof result.has_publishable !== "boolean" ||
        (!captureOnly && !/^[0-9a-f]{40}$/.test(result.base_sha))) {
      fail(`driver result has an invalid schema: ${artifact.name}`);
    }
    exactRootEntries(
      artifact.directory,
      captureOnly
        ? ["capture-retries.json", "result.json", metadataName]
        : [
          "base-sha.txt", "candidate.patch", "capture-retries.json", "changed-tools.json",
          "codex-summary.md", "result.json", "retry-report.json", "review-result.json", metadataName,
        ],
      `driver artifact ${artifact.name}`,
    );
    const approved = stringArray(result.approved_tools, "driver approved_tools", planByTool);
    const resultRetries = stringArray(result.retry_tools, "driver retry_tools", planByTool);
    if (result.has_publishable !== (approved.length > 0)) {
      fail(`driver publication flag does not match approved_tools: ${artifact.name}`);
    }
    if ((metadata.source === "positive_cache" && !result.has_publishable) ||
        (metadata.source === "retry_cache" && result.has_publishable)) {
      fail(`driver cache source does not match its publication decision: ${artifact.name}`);
    }

    let retries = [];
    const retryPath = path.join(artifact.directory, "retry-report.json");
    if (fs.existsSync(retryPath)) {
      const rawRetries = readJson(retryPath, "driver retry report", 1024 * 1024);
      if (!Array.isArray(rawRetries)) fail(`driver retry report must be an array: ${artifact.name}`);
      const retryTools = new Set();
      retries = rawRetries.map((entry) => {
        if (
          !exactKeys(entry, ["tool", "outcome", "review_input_hash", "issues"]) ||
          !planByTool.has(entry.tool) ||
          entry.outcome !== "retry_capture" ||
          !validHash(entry.review_input_hash) ||
          !Array.isArray(entry.issues) ||
          retryTools.has(entry.tool)
        ) {
          fail(`driver retry report contains an invalid or duplicate entry: ${artifact.name}`);
        }
        retryTools.add(entry.tool);
        return { tool: entry.tool, reviewInputHash: entry.review_input_hash };
      });
    } else if (metadata.source !== "capture_only") {
      fail(`reviewed driver artifact is missing retry-report.json: ${artifact.name}`);
    }

    const captureRetries = captureRetryPartition(artifact.directory, planByTool, `driver artifact ${artifact.name}`);
    const approvedSet = new Set(approved);
    const reviewerRetries = new Set(retries.map((retry) => retry.tool));
    if (retries.some((retry) => approvedSet.has(retry.tool))) {
      fail(`driver artifact approves and retries the same tool: ${artifact.name}`);
    }
    if (captureOnly && (approved.length > 0 || retries.length > 0)) {
      fail(`capture_only driver artifact may not contain reviewer decisions: ${artifact.name}`);
    }
    for (const tool of captureRetries) {
      if (approvedSet.has(tool) || reviewerRetries.has(tool)) {
        fail(`driver artifact places ${tool} in more than one decision partition: ${artifact.name}`);
      }
    }
    const partitionRetries = new Set([...reviewerRetries, ...captureRetries]);
    if (resultRetries.length !== partitionRetries.size || resultRetries.some((tool) => !partitionRetries.has(tool))) {
      fail(`driver retry_tools does not equal the reviewer and capture retry partitions: ${artifact.name}`);
    }
    if (approvedSet.size + partitionRetries.size !== planByTool.size) {
      fail(`driver artifact does not partition every planned tool exactly once: ${artifact.name}`);
    }
    events.push({ kind: "driver", order: 1, attempt, metadata, approved, retries });
  }
  return events;
}

function validateEventChronology(events) {
  const bucketsByAttempt = new Map();
  for (const event of events) {
    const previous = bucketsByAttempt.get(event.attempt);
    if (previous !== undefined && previous !== event.metadata.capture_bucket) {
      fail(`workflow attempt ${event.attempt} contains conflicting capture buckets`);
    }
    bucketsByAttempt.set(event.attempt, event.metadata.capture_bucket);
  }
  let previousBucket = null;
  for (const attempt of [...bucketsByAttempt.keys()].sort((left, right) => left - right)) {
    const bucket = bucketsByAttempt.get(attempt);
    if (previousBucket !== null && bucket < previousBucket) {
      fail(`workflow attempt ${attempt} moves backward to an older capture bucket`);
    }
    previousBucket = bucket;
  }
}

function clearEntry(planHash, history = {}) {
  return {
    plan_hash: planHash,
    state: "clear",
    request_after_run_id: null,
    request_after_run_attempt: null,
    last_fresh_bucket: history.last_fresh_bucket ?? null,
    last_reviewer_input_hash: history.last_reviewer_input_hash ?? null,
    reason: null,
  };
}

function clearState(entry) {
  return clearEntry(entry.plan_hash, entry);
}

function forceAfter(entry, event, reason) {
  return {
    ...entry,
    state: "force_once",
    request_after_run_id: event.metadata.run_id,
    request_after_run_attempt: event.metadata.run_attempt,
    reason,
  };
}

function suppressPositive(entry, reason) {
  return {
    ...entry,
    state: "suppress_positive",
    request_after_run_id: null,
    request_after_run_attempt: null,
    reason,
  };
}

function compareEventToRequest(event, entry) {
  if (entry.request_after_run_id === null || entry.request_after_run_attempt === null) return 1;
  const runComparison = BigInt(event.metadata.run_id) - BigInt(entry.request_after_run_id);
  if (runComparison > 0n) return 1;
  if (runComparison < 0n) return -1;
  return Math.sign(event.metadata.run_attempt - entry.request_after_run_attempt);
}

function applyCapture(entry, event) {
  const metadata = event.metadata;
  let next = { ...entry };
  if (metadata.source === "fresh") {
    next.last_fresh_bucket =
      next.last_fresh_bucket === null || metadata.capture_bucket > next.last_fresh_bucket
        ? metadata.capture_bucket
        : next.last_fresh_bucket;
  }

  if (metadata.security_degraded) {
    if (
      next.state === "suppress_positive" &&
      next.reason === "security" &&
      metadata.capture_bucket === next.last_fresh_bucket
    ) {
      return next;
    }
    const eventComparedToRequest = compareEventToRequest(event, next);
    const pendingForceSatisfied = next.state === "force_once" && eventComparedToRequest > 0;
    const blockedByLaterForce = next.state === "force_once" && !pendingForceSatisfied;
    if (pendingForceSatisfied || (metadata.forced && !blockedByLaterForce)) {
      return suppressPositive(next, "security");
    }
    if (!blockedByLaterForce) {
      next = forceAfter(next, event, "security");
    }
    return next;
  }

  if (metadata.source === "retry_cache") {
    const blockedByLaterForce = next.state === "force_once" && compareEventToRequest(event, next) <= 0;
    return blockedByLaterForce ? next : suppressPositive(next, "capture_retry");
  }
  if (metadata.source !== "fresh") return next;

  const pendingForceSatisfied = next.state === "force_once" && compareEventToRequest(event, next) > 0;
  const blockedByLaterForce = next.state === "force_once" && !pendingForceSatisfied;
  if (metadata.status === "retry_capture") {
    return blockedByLaterForce ? next : suppressPositive(next, "capture_retry");
  }

  // A reviewer retry emitted after a fresh capture in this bucket intentionally
  // suppresses more positive-cache work for the rest of the bucket.  Replaying
  // the same attempt must not let the earlier capture clear that later decision.
  if (
    next.state === "suppress_positive" &&
    next.reason === "reviewer" &&
    !metadata.forced &&
    metadata.capture_bucket === next.last_fresh_bucket
  ) {
    return next;
  }

  const manualResult = metadata.forced && !blockedByLaterForce;
  const refreshesSuppression = next.state === "suppress_positive";
  if (!pendingForceSatisfied && !manualResult && !refreshesSuppression) return next;

  return clearState(next);
}

function applyDriver(entries, event) {
  for (const tool of event.approved) entries.set(tool, clearState(entries.get(tool)));

  for (const retry of event.retries) {
    const { tool, reviewInputHash: inputHash } = retry;
    let entry = entries.get(tool);
    if (!validHash(inputHash)) fail(`reviewer retry for ${tool} is missing a trusted per-tool input hash`);
    if (entry.last_reviewer_input_hash === inputHash) {
      if (
        entry.state === "suppress_positive" &&
        entry.reason === "capture_retry" &&
        entry.last_fresh_bucket === event.metadata.capture_bucket
      ) {
        entries.set(tool, suppressPositive(entry, "reviewer"));
      }
      continue;
    }

    entry = { ...entry, last_reviewer_input_hash: inputHash };
    if (entry.state === "force_once" && compareEventToRequest(event, entry) <= 0) {
      entries.set(tool, entry);
      continue;
    }
    if (entry.last_fresh_bucket === event.metadata.capture_bucket) {
      entries.set(tool, suppressPositive(entry, "reviewer"));
    } else {
      entries.set(tool, forceAfter(entry, event, "reviewer"));
    }
  }
}

if (
  !priorStateArg ||
  !planArg ||
  !captureDownloadsArg ||
  !driverDownloadsArg ||
  !outputArg ||
  !positiveRunId(currentRunId) ||
  !/^[1-9][0-9]*$/.test(currentAttemptArg || "") ||
  !validBucket(currentBucket)
) {
  fail(
    "Usage: update-recapture-state.cjs <prior-state> <plan> <capture-downloads> <driver-downloads> <run-id> <attempt> <YYYYMMDD> <output>",
  );
}

const currentAttempt = Number(currentAttemptArg);
if (!positiveAttempt(currentAttempt)) fail("current workflow attempt must be a positive safe integer");

const prior = validateState(readJson(path.resolve(priorStateArg), "prior recapture state", 256 * 1024));
const planByTool = validatePlan(readJson(path.resolve(planArg), "capture plan", 2 * 1024 * 1024));
const entries = new Map();
for (const [tool, plan] of planByTool) {
  const previous = prior.tools[tool];
  entries.set(
    tool,
    previous && previous.plan_hash === plan.plan_hash
      ? { ...previous }
      : clearEntry(plan.plan_hash),
  );
}

const events = [...captureEvents(planByTool), ...driverEvents(planByTool)].sort((left, right) =>
  left.attempt - right.attempt || left.order - right.order || (left.tool || "").localeCompare(right.tool || ""),
);
validateEventChronology(events);
for (const event of events) {
  if (event.kind === "capture") entries.set(event.tool, applyCapture(entries.get(event.tool), event));
  else applyDriver(entries, event);
}

const output = {
  schema_version: 1,
  tools: Object.fromEntries(entries),
};
validateState(output);

const outputPath = path.resolve(outputArg);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
if (fs.existsSync(outputPath)) {
  const stat = fs.lstatSync(outputPath);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("recapture state output path must be a regular file");
}
const temporary = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${process.pid}.tmp`);
try {
  fs.writeFileSync(temporary, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.rmSync(outputPath, { force: true });
  fs.renameSync(temporary, outputPath);
} finally {
  fs.rmSync(temporary, { force: true });
}

console.log(`Updated durable recapture state for ${entries.size} planned tool(s) through attempt ${currentAttempt}.`);
