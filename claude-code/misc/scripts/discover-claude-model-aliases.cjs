#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const [traceArg] = process.argv.slice(2);
if (!traceArg) {
  console.error("Usage: discover-claude-model-aliases.cjs <interactive-trace-dir>");
  process.exit(2);
}

const traceDir = path.resolve(traceArg);
const marker = "CLAUDE_INTERACTIVE_TRACE_OK";

function successful(record) {
  const response = record.response || {};
  return response.ok === true && response.completed === true && response.error_event !== true &&
    Number.isInteger(response.status) && response.status >= 200 && response.status < 300;
}

function collectModelEnums(value, aliases) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectModelEnums(item, aliases);
    return;
  }

  const model = value.properties?.model;
  if (model?.type === "string" && Array.isArray(model.enum)) {
    for (const candidate of model.enum) {
      if (typeof candidate === "string" && /^[a-z][a-z0-9-]*$/.test(candidate)) {
        aliases.add(candidate);
      }
    }
  }

  for (const nested of Object.values(value)) collectModelEnums(nested, aliases);
}

const aliases = new Set();
let markerRecords = 0;
for (const entry of fs.readdirSync(traceDir).sort()) {
  if (!entry.endsWith(".json")) continue;
  const record = JSON.parse(fs.readFileSync(path.join(traceDir, entry), "utf8"));
  if (!record.request?.body || !successful(record)) continue;
  let body;
  try {
    body = JSON.parse(record.request.body);
  } catch {
    continue;
  }
  if (!Array.isArray(body.tools) || body.tools.length === 0) continue;
  if (!JSON.stringify(body.messages || []).includes(marker)) continue;
  markerRecords += 1;
  for (const tool of body.tools) collectModelEnums(tool.input_schema, aliases);
}

if (markerRecords === 0) {
  throw new Error(`No completed Claude interactive marker request found in ${traceDir}`);
}
if (aliases.size === 0) {
  throw new Error("Claude tool schemas did not advertise any model aliases");
}

process.stdout.write(`${[...aliases].sort().join("\n")}\n`);
