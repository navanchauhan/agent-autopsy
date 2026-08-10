#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const manifestPath = path.resolve(process.argv[2]);
const outputPath = path.resolve(process.argv[3]);
const message = process.argv[4] || "The normalization pass produced no publishable candidate; retry capture later.";
const tools = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(tools) || tools.length === 0) throw new Error("safe retry requires a non-empty manifest");

const issue = {
  severity: "error",
  code: "normalization_incomplete",
  path: "",
  message,
};
const review = {
  decision: "retry_capture",
  publish_safe: false,
  summary: message,
  issues: [issue],
  tool_results: tools.map((entry) => ({
    tool: entry.tool,
    outcome: "retry_capture",
    capture_complete: false,
    changes_supported_by_evidence: false,
    inventory_consistent: false,
    provenance_noise_excluded: true,
    pii_removed: true,
    secret_safe: true,
    issues: [{ ...issue, path: entry.dir }],
  })),
};
fs.writeFileSync(outputPath, `${JSON.stringify(review, null, 2)}\n`);
