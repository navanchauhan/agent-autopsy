#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const planPath = path.resolve(process.argv[2]);
const outputRoot = path.resolve(process.argv[3]);
const message = process.argv[4] || "Capture bundle failed immutable host verification; retry with fresh evidence.";
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
if (!Array.isArray(plan) || plan.length !== 1) throw new Error("safe capture retry requires exactly one plan entry");
const entry = plan[0];
if (!entry || !["codex", "claude-code", "grok", "antigravity", "qwen-code"].includes(entry.tool)) {
  throw new Error("safe capture retry contains an unsupported tool");
}
if (typeof message !== "string" || message.length < 1 || message.length > 4096) {
  throw new Error("safe capture retry message is invalid");
}
const toolDir = path.join(outputRoot, entry.tool);
fs.rmSync(toolDir, { recursive: true, force: true });
fs.mkdirSync(toolDir, { recursive: true });
fs.writeFileSync(path.join(toolDir, "result.json"), `${JSON.stringify({
  tool: entry.tool,
  target_version: entry.new_version,
  status: "retry_capture",
  message,
  capture_contract_hash: entry.capture_contract_hash,
  plan_hash: entry.plan_hash,
}, null, 2)}\n`, { mode: 0o600 });
