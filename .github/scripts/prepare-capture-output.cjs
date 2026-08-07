#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const [tool, sourceArg, destinationArg] = process.argv.slice(2);
if (!tool || !sourceArg || !destinationArg || !/^[A-Za-z0-9._-]+$/.test(tool)) {
  console.error("Usage: prepare-capture-output.cjs <tool> <scratch-dir> <output-dir>");
  process.exit(2);
}

const source = path.resolve(sourceArg);
const destination = path.resolve(destinationArg);
const allowedExtensions = new Set([
  ".json",
  ".jsonl",
  ".md",
  ".txt",
  ".version",
]);
const maxFileBytes = 64 * 1024 * 1024;
const maxTotalBytes = 350 * 1024 * 1024;
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
  "accesstoken",
  "apikey",
  "authorization",
  "clientsecret",
  "cookie",
  "idtoken",
  "proxyauthorization",
  "refreshtoken",
  "setcookie",
  "xapikey",
]);

function normalizedKey(key) {
  return key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function isRedacted(value) {
  return value === "***" || /^<redacted>$/i.test(value);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function walk(dir, base = dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(base, absolute).replaceAll("\\", "/");
    if (entry.isSymbolicLink()) throw new Error(`symbolic link is not allowed: ${relative}`);
    if (entry.isDirectory()) files.push(...walk(absolute, base));
    else if (entry.isFile()) files.push({ absolute, relative });
    else throw new Error(`unsupported filesystem entry is not allowed: ${relative}`);
  }
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
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
      typeof child === "string" &&
      !isRedacted(child) &&
      child.length > 0
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

if (!fs.existsSync(source)) {
  throw new Error(`capture scratch directory does not exist: ${source}`);
}
const sourceStat = fs.lstatSync(source);
if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
  throw new Error(`capture scratch path must be a real directory: ${source}`);
}

const files = walk(source);
let totalBytes = 0;
const manifest = [];
const retainedFiles = [];
for (const file of files) {
  const extension = path.extname(file.relative).toLowerCase();
  if (!allowedExtensions.has(extension) && path.basename(file.relative) !== "VERSION") continue;
  if (file.relative === "evidence-manifest.json") {
    throw new Error("capture scratch must not supply the reserved evidence-manifest.json file");
  }
  const sourceFileStat = fs.lstatSync(file.absolute);
  if (!sourceFileStat.isFile() || sourceFileStat.isSymbolicLink()) {
    throw new Error(`capture evidence must remain a regular file: ${file.relative}`);
  }
  const buffer = fs.readFileSync(file.absolute);
  if (buffer.length > maxFileBytes) throw new Error(`${file.relative} exceeds 64 MiB`);
  totalBytes += buffer.length;
  if (totalBytes > maxTotalBytes) throw new Error("capture evidence exceeds 350 MiB");
  if (buffer.includes(0)) throw new Error(`NUL byte is not allowed in text evidence ${file.relative}`);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new Error(`capture evidence is not valid UTF-8 (${file.relative}: ${error.message})`);
  }
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) throw new Error(`possible ${label} in ${file.relative}`);
  }
  if (extension === ".json" || extension === ".jsonl") {
    const lines = extension === ".jsonl" ? text.split(/\r?\n/).filter(Boolean) : [text];
    lines.forEach((line, index) => {
      try {
        inspectSensitiveKeys(JSON.parse(line), "$", `${file.relative}${lines.length > 1 ? `:${index + 1}` : ""}`);
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`invalid JSON evidence ${file.relative}: ${error.message}`);
        throw error;
      }
    });
  }
  manifest.push({ path: file.relative, bytes: buffer.length, sha256: sha256(buffer) });
  retainedFiles.push({ path: file.relative, buffer });
}

if (manifest.length === 0) throw new Error(`no allowlisted capture evidence was produced for ${tool}`);

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
const destinationStat = fs.lstatSync(destination);
if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
  throw new Error(`capture output path must be a real directory: ${destination}`);
}
for (const file of retainedFiles) {
  const to = path.join(destination, ...file.path.split("/"));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, file.buffer, { mode: 0o600 });
}
fs.writeFileSync(
  path.join(destination, "evidence-manifest.json"),
  `${JSON.stringify({ tool, total_bytes: totalBytes, files: manifest }, null, 2)}\n`,
);
console.log(`Prepared ${manifest.length} redacted evidence file(s) for ${tool}`);
