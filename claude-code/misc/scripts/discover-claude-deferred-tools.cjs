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
const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const markerPattern = new RegExp(`(?:^|[^A-Za-z0-9_.-])${escapedMarker}(?:$|[^A-Za-z0-9_.-])`);

function strings(value, found = []) {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) value.forEach((child) => strings(child, found));
  else if (value && typeof value === "object") Object.values(value).forEach((child) => strings(child, found));
  return found;
}

function messageStrings(body) {
  return strings(Array.isArray(body?.messages) ? body.messages : []);
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
  if (
    record?.response?.ok !== true ||
    record?.response?.completed !== true ||
    record?.response?.error_event === true ||
    !Number.isInteger(record?.response?.status) ||
    record.response.status < 200 ||
    record.response.status >= 300
  ) return null;
  let body;
  try {
    body = JSON.parse(record?.request?.body || "");
  } catch {
    return null;
  }
  if (body?.stream === true && record.response.terminal_event !== true) return null;
  return messageStrings(body).some((value) => markerPattern.test(value)) ? body : null;
}

const entries = fs.readdirSync(traceDir).filter((name) => name.endsWith(".json")).sort();
const bodies = [];
for (const name of entries) {
  const body = parseTrace(path.join(traceDir, name));
  if (body) bodies.push(body);
}
if (bodies.length === 0) throw new Error(`no successful base request contained marker ${marker}`);

const discovered = new Set();
function add(candidate) {
  if (namePattern.test(candidate) && !excluded.has(candidate)) discovered.add(candidate);
}

function advertisedList(block) {
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((line) => /\bdefer(?:red)?\s+tools?\b/i.test(line));
  if (start < 0) return null;

  let header = "";
  for (let index = start; index < lines.length && index <= start + 8; index += 1) {
    header += `${header ? "\n" : ""}${lines[index]}`;
    const namesAreAdvertised =
      /\bdefer(?:red)?\s+tools?\b/i.test(header) &&
      /\bToolSearch\b/i.test(header) &&
      (/\bavailable\b/i.test(header) || /\bdefer(?:red)?\s+tools?\s+(?:are\s+)?(?:now\s+)?via\s+ToolSearch\b/i.test(header));
    if (!namesAreAdvertised) continue;

    // Current Claude releases terminate the explanatory header with a colon,
    // then advertise one name per line. Using the line-ending colon avoids
    // mistaking the `select:<name>` example inside that header for the list.
    if (/:\s*$/.test(lines[index])) return lines.slice(index + 1).join("\n");

    // Retain support for the compact historical form:
    // `Deferred tools via ToolSearch: ToolOne, ToolTwo`.
    const inline = lines[index].match(
      /^\s*(?:the\s+following\s+)?defer(?:red)?\s+tools?\s+(?:are\s+)?(?:now\s+)?(?:available\s+)?via\s+ToolSearch\s*:\s*(.+)$/i,
    );
    if (inline) return [inline[1], ...lines.slice(index + 1)].join("\n");
  }
  return null;
}

for (const body of bodies) {
  for (const text of messageStrings(body)) {
    const blocks = [...text.matchAll(/<system-reminder\b[^>]*>([\s\S]*?)<\/system-reminder>/gi)]
      .map((match) => match[1])
      .filter((block) => /defer(?:red)?\s+tools?|ToolSearch/i.test(block));
    for (const block of blocks) {
      const advertised = advertisedList(block);
      if (advertised === null) continue;
      // Examples describe how to invoke ToolSearch; their names are not an
      // advertisement from this exact CLI release. Exclude the entire section
      // before applying any syntax-specific extractor, including quoted and
      // bulleted examples.
      const evidenceBlock = advertised.split(/\r?\n(?=\s*(?:examples?|usage)\s*:)/i, 1)[0];
      const firstLine = evidenceBlock.split(/\r?\n/, 1)[0];
      for (const token of firstLine.split(/[\s,;]+/)) add(token.replace(/^[`"']|[`"'.:]$/g, ""));
      for (const match of evidenceBlock.matchAll(/`([A-Z][A-Za-z0-9]{2,63})`/g)) add(match[1]);
      for (const match of evidenceBlock.matchAll(/["']([A-Z][A-Za-z0-9]{2,63})["']/g)) add(match[1]);
      for (const match of evidenceBlock.matchAll(/(?:^|\n)\s*(?:[-*]|[0-9]+\.)\s*([A-Z][A-Za-z0-9]{2,63})(?=\s|[,;:]|$)/g)) add(match[1]);

      // Claude Code 2.1.221 advertises deferred tools as one bare identifier
      // per line after the explanatory text. Stop at example/usage sections so
      // illustrative identifiers cannot become capture requirements.
      for (const line of evidenceBlock.split(/\r?\n/)) {
        const trimmed = line.trim();
        const match = trimmed.match(/^(?:[-*]\s+|[0-9]+\.\s+)?[`"']?([A-Z][A-Za-z0-9]{2,63})[`"']?[,;]?$/);
        if (match) add(match[1]);
      }
    }
  }
}

if (discovered.size === 0) {
  throw new Error(`successful base request contained marker ${marker}, but advertised no deferred tool names`);
}

for (const name of [...discovered].sort()) console.log(name);
