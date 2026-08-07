#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const [traceDirArg, marker] = process.argv.slice(2);
if (!traceDirArg || !marker || !/^[A-Za-z0-9_.-]{3,160}$/.test(marker)) {
  console.error("Usage: discover-claude-deferred-tools.cjs <trace-dir> <marker>");
  process.exit(2);
}

const traceDir = path.resolve(traceDirArg);
const namePattern = /^[A-Z][A-Za-z0-9]{2,63}$/;
const excluded = new Set([
  "DeferredToolPlaceholder", "JSONSchema", "SystemReminder", "ToolSearch",
]);

function strings(value, found = []) {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) value.forEach((child) => strings(child, found));
  else if (value && typeof value === "object") Object.values(value).forEach((child) => strings(child, found));
  return found;
}

function parseTrace(file) {
  let stat;
  let record;
  try {
    stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 16 * 1024 * 1024) return null;
    record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file)));
  } catch {
    // Trace writers use an atomic rename, but skip unrelated, truncated, or
    // non-UTF-8 files defensively instead of losing an otherwise valid batch.
    return null;
  }
  if (record?.response?.ok !== true || record?.response?.completed !== true || record?.response?.error_event === true) return null;
  let body;
  try {
    body = JSON.parse(record?.request?.body || "");
  } catch {
    return null;
  }
  return JSON.stringify(body).includes(marker) ? body : null;
}

const entries = fs.readdirSync(traceDir).filter((name) => name.endsWith(".json")).sort();
let body = null;
for (const name of entries) {
  body = parseTrace(path.join(traceDir, name));
  if (body) break;
}
if (!body) throw new Error(`no successful base request contained marker ${marker}`);

const discovered = new Set();
function add(candidate) {
  if (namePattern.test(candidate) && !excluded.has(candidate)) discovered.add(candidate);
}

for (const text of strings(body)) {
  const blocks = [...text.matchAll(/<system-reminder\b[^>]*>([\s\S]*?)<\/system-reminder>/gi)]
    .map((match) => match[1])
    .filter((block) => /defer(?:red)?\s+tools?|ToolSearch/i.test(block));
  for (const block of blocks) {
    for (const match of block.matchAll(/`([A-Z][A-Za-z0-9]{2,63})`/g)) add(match[1]);
    for (const match of block.matchAll(/["']([A-Z][A-Za-z0-9]{2,63})["']/g)) add(match[1]);
    for (const match of block.matchAll(/(?:^|\n)\s*(?:[-*]|[0-9]+\.)\s*([A-Z][A-Za-z0-9]{2,63})(?=\s|[,;:]|$)/g)) add(match[1]);
    for (const match of block.matchAll(/(?:deferred tools?|ToolSearch[^:\n]{0,80})\s*:\s*([^\n<]+)/gi)) {
      for (const token of match[1].split(/[\s,;]+/)) add(token.replace(/^[`"']|[`"'.:]$/g, ""));
    }
  }
}

for (const name of [...discovered].sort()) console.log(name);
