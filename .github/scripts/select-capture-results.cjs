#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const planPath = path.resolve(process.argv[2] || ".capture-scratch/changed-tools.json");
const outputRoot = path.resolve(process.argv[3] || "capture-output");
const readyPath = path.resolve(process.argv[4] || ".capture-scratch/ready-tools.json");
const retryPath = path.resolve(process.argv[5] || ".capture-scratch/capture-retries.json");
const knownDirectories = new Map([
  ["codex", "codex"],
  ["claude-code", "claude-code"],
  ["grok", "grok"],
  ["antigravity", "antigravity"],
]);

function readRegularJson(file, label, maxBytes = 4 * 1024 * 1024) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes) {
    throw new Error(`${label} must be a nonempty regular file no larger than ${maxBytes} bytes`);
  }
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) throw new Error(`${label} contains a NUL byte`);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8: ${error.message}`);
  }
  return JSON.parse(text);
}

function requireRealDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function verifyExactDirectoryEntries(directory, expectedEntries, label) {
  requireRealDirectory(directory, label);
  const actualNames = fs.readdirSync(directory).sort();
  const expectedNames = [...expectedEntries.keys()].sort();
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error(`${label} must contain exactly: ${expectedNames.join(", ")}`);
  }
  for (const [name, expectedType] of expectedEntries) {
    const stat = fs.lstatSync(path.join(directory, name));
    if (stat.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${name}`);
    if (expectedType === "file" && !stat.isFile()) throw new Error(`${label}/${name} must be a regular file`);
    if (expectedType === "directory" && !stat.isDirectory()) throw new Error(`${label}/${name} must be a real directory`);
  }
}

function sanitizeDeferredOutput(directory, label) {
  requireRealDirectory(directory, label);
  for (const name of fs.readdirSync(directory)) {
    if (name === "result.json") continue;
    fs.rmSync(path.join(directory, name), { recursive: true, force: true });
  }
  verifyExactDirectoryEntries(directory, new Map([["result.json", "file"]]), label);
}

const allowedExtensions = new Set([".json", ".jsonl", ".md", ".txt", ".version"]);
const secretPatterns = [
  ["private key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["OpenAI-style API key", /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["Google OAuth token", /\bya29\.[A-Za-z0-9_-]{20,}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  [
    "authorization header",
    /\b(?:authorization|proxy-authorization)\s*[:=]\s*["']?(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{20,}/i,
  ],
];
const sensitiveKeys = new Set([
  "accesstoken", "apikey", "authorization", "clientsecret", "cookie", "idtoken",
  "proxyauthorization", "refreshtoken", "setcookie", "xapikey",
]);

function normalizedKey(key) {
  return key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function isRedacted(value) {
  return value === "***" || /^<redacted>$/i.test(value);
}

function inspectSensitiveKeys(value, jsonPath, file, depth = 0) {
  if (depth > 32) throw new Error(`JSON nesting exceeds the safety limit in ${file}:${jsonPath}`);
  if (Array.isArray(value)) {
    value.forEach((child, index) => inspectSensitiveKeys(child, `${jsonPath}[${index}]`, file, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (
      sensitiveKeys.has(normalizedKey(key)) &&
      typeof child === "string" && !isRedacted(child) && child.length > 0
    ) {
      throw new Error(`credential-shaped value at ${file}:${jsonPath}.${key}`);
    }
    if (typeof child === "string" && child.length <= 2 * 1024 * 1024 && /^[\s]*[\[{]/.test(child)) {
      try {
        inspectSensitiveKeys(JSON.parse(child), `${jsonPath}.${key}<serialized>`, file, depth + 1);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    inspectSensitiveKeys(child, `${jsonPath}.${key}`, file, depth + 1);
  }
}

function inspectEvidence(buffer, relative) {
  if (buffer.length > 64 * 1024 * 1024) throw new Error(`evidence exceeds 64 MiB: ${relative}`);
  if (buffer.includes(0)) throw new Error(`NUL byte in text evidence: ${relative}`);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new Error(`invalid UTF-8 evidence ${relative}: ${error.message}`);
  }
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) throw new Error(`possible ${label} in evidence: ${relative}`);
  }
  const extension = path.extname(relative).toLowerCase();
  if (extension === ".json" || extension === ".jsonl") {
    const lines = extension === ".jsonl" ? text.split(/\r?\n/).filter(Boolean) : [text];
    for (let index = 0; index < lines.length; index += 1) {
      try {
        inspectSensitiveKeys(JSON.parse(lines[index]), "$", `${relative}${lines.length > 1 ? `:${index + 1}` : ""}`);
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`invalid JSON evidence ${relative}: ${error.message}`);
        throw error;
      }
    }
  }
}

function verifyEvidence(entry, evidenceDir) {
  requireRealDirectory(evidenceDir, `${entry.tool} evidence`);
  const manifestPath = path.join(evidenceDir, "evidence-manifest.json");
  const manifest = readRegularJson(manifestPath, `${entry.tool} evidence manifest`);
  if (
    !hasExactKeys(manifest, ["tool", "total_bytes", "files"]) ||
    manifest.tool !== entry.tool ||
    !Number.isSafeInteger(manifest.total_bytes) ||
    manifest.total_bytes < 0 ||
    manifest.total_bytes > 350 * 1024 * 1024 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  ) {
    throw new Error("evidence manifest is empty or belongs to a different tool");
  }

  const expected = new Set(["evidence-manifest.json"]);
  const expectedDirectories = new Set();
  let totalBytes = 0;
  for (const record of manifest.files) {
    if (
      !hasExactKeys(record, ["path", "bytes", "sha256"]) ||
      typeof record.path !== "string" ||
      record.path === "" ||
      record.path.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(record.path) ||
      path.posix.isAbsolute(record.path) ||
      record.path.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
      record.path === "evidence-manifest.json" ||
      (!allowedExtensions.has(path.extname(record.path).toLowerCase()) && path.basename(record.path) !== "VERSION") ||
      typeof record.bytes !== "number" ||
      !Number.isSafeInteger(record.bytes) ||
      record.bytes < 0 ||
      record.bytes > 64 * 1024 * 1024 ||
      typeof record.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(record.sha256) ||
      expected.has(record.path)
    ) {
      throw new Error("evidence manifest contains an invalid or duplicate file record");
    }
    expected.add(record.path);
    const segments = record.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      expectedDirectories.add(segments.slice(0, index).join("/"));
    }
    const absolute = path.join(evidenceDir, ...record.path.split("/"));
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`evidence is not a regular file: ${record.path}`);
    const buffer = fs.readFileSync(absolute);
    if (buffer.length !== record.bytes || sha256(buffer) !== record.sha256) {
      throw new Error(`evidence digest mismatch: ${record.path}`);
    }
    inspectEvidence(buffer, record.path);
    totalBytes += buffer.length;
    if (totalBytes > 350 * 1024 * 1024) throw new Error("evidence exceeds 350 MiB in total");
  }
  if (manifest.total_bytes !== totalBytes) throw new Error("evidence byte total does not match its manifest");

  const actual = [];
  function walk(directory, prefix = "") {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isSymbolicLink()) throw new Error(`symbolic link in evidence: ${relative}`);
      if (item.isDirectory()) {
        if (!expectedDirectories.has(relative)) throw new Error(`unmanifested directory in evidence: ${relative}`);
        walk(path.join(directory, item.name), relative);
      }
      else if (item.isFile()) actual.push(relative);
      else throw new Error(`unsupported evidence entry: ${relative}`);
    }
  }
  walk(evidenceDir);
  if (actual.length !== expected.size || actual.some((file) => !expected.has(file))) {
    throw new Error("evidence directory contains files not covered by its manifest");
  }
  return manifest;
}

const plan = readRegularJson(planPath, "capture plan");
if (!Array.isArray(plan)) throw new Error("capture plan must be an array");
if (plan.length > knownDirectories.size) throw new Error("capture plan contains too many tools");
const plannedTools = new Set();
for (const entry of plan) {
  if (
    !entry || typeof entry !== "object" || Array.isArray(entry) ||
    knownDirectories.get(entry.tool) !== entry.dir || plannedTools.has(entry.tool) ||
    typeof entry.new_version !== "string" ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][A-Za-z0-9.]+)?$/.test(entry.new_version) ||
    typeof entry.capture_contract_hash !== "string" ||
    !/^[0-9a-f]{64}$/.test(entry.capture_contract_hash) ||
    typeof entry.plan_hash !== "string" || !/^[0-9a-f]{64}$/.test(entry.plan_hash)
  ) {
    throw new Error(`capture plan contains an invalid entry: ${JSON.stringify(entry)}`);
  }
  plannedTools.add(entry.tool);
}
fs.mkdirSync(outputRoot, { recursive: true });
requireRealDirectory(outputRoot, "capture output root");

const ready = [];
const retries = [];
const evidenceIndex = [];
for (const entry of plan) {
  const toolOutput = path.join(outputRoot, entry.tool);
  const resultPath = path.join(toolOutput, "result.json");
  let result;
  try {
    requireRealDirectory(toolOutput, `${entry.tool} output`);
    result = readRegularJson(resultPath, `${entry.tool} result`, 64 * 1024);
    if (
      !hasExactKeys(result, [
        "tool", "target_version", "status", "message", "capture_contract_hash", "plan_hash",
      ]) ||
      !["captured", "retry_capture", "security_error"].includes(result.status) ||
      typeof result.message !== "string" || result.message.length > 4096
    ) {
      throw new Error("capture result has an invalid schema");
    }
    inspectEvidence(Buffer.from(JSON.stringify(result)), `${entry.tool}/result.json`);
  } catch (error) {
    retries.push({ ...entry, status: "missing_result", message: error.message });
    continue;
  }
  const identityMatches =
    result.tool === entry.tool &&
    result.target_version === entry.new_version &&
    result.capture_contract_hash === entry.capture_contract_hash &&
    result.plan_hash === entry.plan_hash;
  if (!identityMatches) {
    retries.push({
      ...entry,
      status: "stale_result",
      message: "Capture result identity, target, or recipe hash did not match the queued plan.",
    });
    continue;
  }
  if (result.status === "captured") {
    const evidenceDir = path.join(outputRoot, entry.tool, "evidence");
    let evidence;
    try {
      verifyExactDirectoryEntries(
        toolOutput,
        new Map([["evidence", "directory"], ["result.json", "file"]]),
        `${entry.tool} output`,
      );
      evidence = verifyEvidence(entry, evidenceDir);
    } catch (error) {
      retries.push({ ...entry, status: "invalid_evidence", message: error.message });
      continue;
    }
    ready.push(entry);
    evidenceIndex.push({
      tool: entry.tool,
      target_version: entry.new_version,
      capture_contract_hash: entry.capture_contract_hash,
      total_bytes: evidence.total_bytes,
      files: Array.isArray(evidence.files) ? evidence.files : [],
    });
  } else {
    try {
      sanitizeDeferredOutput(toolOutput, `${entry.tool} output`);
    } catch (error) {
      retries.push({ ...entry, status: "invalid_bundle", message: error.message });
      continue;
    }
    retries.push({ ...entry, status: result.status || "retry_capture", message: result.message || "Capture incomplete." });
  }
}

fs.mkdirSync(path.dirname(readyPath), { recursive: true });
fs.writeFileSync(readyPath, `${JSON.stringify(ready, null, 2)}\n`);
fs.writeFileSync(retryPath, `${JSON.stringify(retries, null, 2)}\n`);
fs.writeFileSync(path.join(outputRoot, "evidence-index.json"), `${JSON.stringify(evidenceIndex, null, 2)}\n`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_ready=${ready.length > 0}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `ready_count=${ready.length}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `retry_count=${retries.length}\n`);
}

console.log(`Capture selection: ${ready.length} ready, ${retries.length} deferred.`);
function workflowCommandText(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}
for (const retry of retries) {
  console.log(`::warning::${workflowCommandText(`${retry.tool}: ${retry.message}`)}`);
}
