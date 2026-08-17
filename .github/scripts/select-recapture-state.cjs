#!/usr/bin/env node

const fs = require("fs");

const [file, tool, planHash, bucket] = process.argv.slice(2);
const tools = new Set(["codex", "claude-code", "grok", "antigravity", "qwen-code"]);
const states = new Set(["clear", "force_once", "suppress_positive"]);
const reasons = new Set(["reviewer", "security", "manual", "capture_retry"]);

function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

if (!file || !tools.has(tool) || !/^[0-9a-f]{64}$/.test(planHash || "") || !/^[0-9]{8}$/.test(bucket || "")) {
  throw new Error("Usage: select-recapture-state.cjs <state-file> <tool> <plan-hash> <YYYYMMDD>");
}
const root = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file)));
if (!exact(root, ["schema_version", "tools"]) || root.schema_version !== 1 ||
    !root.tools || typeof root.tools !== "object" || Array.isArray(root.tools)) {
  throw new Error("invalid durable recapture-state root");
}
for (const [name, entry] of Object.entries(root.tools)) {
  if (!tools.has(name) || !exact(entry, [
    "plan_hash", "state", "request_after_run_id", "request_after_run_attempt",
    "last_fresh_bucket", "last_reviewer_input_hash", "reason",
  ]) || !/^[0-9a-f]{64}$/.test(entry.plan_hash) || !states.has(entry.state) ||
      !(entry.request_after_run_id === null || /^[1-9][0-9]*$/.test(entry.request_after_run_id)) ||
      !(entry.request_after_run_attempt === null || Number.isSafeInteger(entry.request_after_run_attempt) && entry.request_after_run_attempt > 0) ||
      !(entry.last_fresh_bucket === null || /^[0-9]{8}$/.test(entry.last_fresh_bucket)) ||
      !(entry.last_reviewer_input_hash === null || /^[0-9a-f]{64}$/.test(entry.last_reviewer_input_hash)) ||
      !(entry.reason === null || reasons.has(entry.reason)) ||
      (entry.state === "clear" && (entry.request_after_run_id !== null || entry.request_after_run_attempt !== null || entry.reason !== null)) ||
      (entry.state === "force_once" && (entry.request_after_run_id === null || entry.request_after_run_attempt === null ||
        !["reviewer", "security", "manual"].includes(entry.reason))) ||
      (entry.state === "suppress_positive" && (entry.request_after_run_id !== null || entry.request_after_run_attempt !== null ||
        !["reviewer", "security", "capture_retry"].includes(entry.reason)))) {
    throw new Error(`invalid durable recapture state for ${name}`);
  }
}

const selected = root.tools[tool]?.plan_hash === planHash ? root.tools[tool] : null;
const state = selected?.state || "clear";
const lines = [
  `state=${state}`,
  `force=${state === "force_once"}`,
  `suppress_positive=${state === "suppress_positive"}`,
  `same_bucket=${state === "suppress_positive" && selected?.last_fresh_bucket === bucket}`,
];
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
