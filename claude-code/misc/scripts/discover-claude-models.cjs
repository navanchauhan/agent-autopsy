#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const [traceArg, registryArg] = process.argv.slice(2);
if (!traceArg) {
  console.error("Usage: discover-claude-models.cjs <interactive-trace-dir> [SURFACES.json]");
  process.exit(2);
}

const traceDir = path.resolve(traceArg);
const marker = "CLAUDE_INTERACTIVE_TRACE_OK";

function systemText(body) {
  if (typeof body.system === "string") return body.system;
  if (!Array.isArray(body.system)) return "";
  return body.system
    .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function validModel(value) {
  return typeof value === "string" && /^claude-[a-z0-9]+(?:-[a-z0-9]+)+$/.test(value);
}

function successful(record) {
  const response = record.response || {};
  return response.ok === true && response.completed === true && response.error_event !== true &&
    Number.isInteger(response.status) && response.status >= 200 && response.status < 300;
}

const markerRecords = [];
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
  markerRecords.push(body);
}

if (markerRecords.length === 0) {
  throw new Error(`No completed Claude interactive marker request found in ${traceDir}`);
}

// Claude publishes its current model inventory as quoted exact IDs in the
// model-facing system prompt. Quoting distinguishes the inventory from prose,
// examples, package names, and request identifiers that also start with
// "claude-". No model name is fixed in this script.
const advertised = new Set();
for (const body of markerRecords) {
  const text = systemText(body);
  for (const match of text.matchAll(/["'](claude-[a-z0-9]+(?:-[a-z0-9]+)+)["']/g)) {
    if (validModel(match[1])) advertised.add(match[1]);
  }
}

const hasAdvertisedInventory = advertised.size > 0;
const models = new Set(advertised);
for (const body of markerRecords) {
  if (validModel(body.model)) models.add(body.model);
}

// Older releases did not always publish an explicit quoted list. In that case,
// use the last evidence-backed captured prompt inventory as the fallback rather
// than embedding a product model list in automation.
if (!hasAdvertisedInventory && registryArg) {
  const registry = JSON.parse(fs.readFileSync(path.resolve(registryArg), "utf8"));
  for (const surface of registry.surfaces || []) {
    if (surface.category !== "agent prompt") continue;
    if (!Array.isArray(surface.modes) || !surface.modes.includes("non-interactive")) continue;
    for (const model of surface.models || []) if (validModel(model)) models.add(model);
  }
}

if (models.size === 0) throw new Error("Claude model discovery produced an empty inventory");
process.stdout.write(`${[...models].sort().join("\n")}\n`);
