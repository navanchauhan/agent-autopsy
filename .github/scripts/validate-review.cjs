#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = childProcess
  .execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" })
  .trim();
const scratchDir = process.env.CAPTURE_SCRATCH_DIR || path.join(repoRoot, ".capture-scratch");
const changedPath = path.resolve(
  process.argv[2] || process.env.CHANGED_TOOLS_FILE || path.join(scratchDir, "changed-tools.json"),
);
const reviewPath = path.resolve(
  process.argv[3] || process.env.CODEX_REVIEW_FILE || path.join(scratchDir, "review-result.json"),
);

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function hasChanges(dir) {
  return childProcess.execFileSync("git", ["status", "--porcelain", "--", dir], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim() !== "";
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: node .github/scripts/validate-review.cjs [changed-tools.json] [review-result.json]");
    return;
  }

  const changed = readJson(changedPath, "changed tools");
  const review = readJson(reviewPath, "review result");
  const errors = [];

  if (!Array.isArray(changed)) errors.push("changed tools must be an array");
  if (review.decision !== "approve" || review.publish_safe !== true) {
    errors.push("review must approve publication");
  }
  if (!Array.isArray(review.issues)) {
    errors.push("review issues must be an array");
  } else if (review.issues.some((issue) => issue?.severity === "error")) {
    errors.push("an approved review cannot contain top-level error issues");
  }

  const expected = Array.isArray(changed) ? changed : [];
  const results = Array.isArray(review.tool_results) ? review.tool_results : [];
  if (!Array.isArray(review.tool_results)) errors.push("tool_results must be an array");
  if (results.length !== expected.length) {
    errors.push(`expected ${expected.length} tool result(s), found ${results.length}`);
  }

  let approvedCount = 0;
  const count = Math.max(expected.length, results.length);
  for (let index = 0; index < count; index += 1) {
    const tool = expected[index];
    const result = results[index];
    if (!tool || !result) continue;
    if (result.tool !== tool.tool) {
      errors.push(`tool result ${index + 1} must be ${JSON.stringify(tool.tool)}`);
      continue;
    }
    if (!Array.isArray(result.issues)) {
      errors.push(`${tool.tool}: issues must be an array`);
      continue;
    }
    if (result.issues.some((issue) => issue?.severity === "error")) {
      errors.push(`${tool.tool}: an approved review cannot contain error issues`);
    }

    if (result.outcome === "approve") {
      approvedCount += 1;
      for (const field of [
        "capture_complete",
        "changes_supported_by_evidence",
        "inventory_consistent",
        "provenance_noise_excluded",
        "secret_safe",
      ]) {
        if (result[field] !== true) errors.push(`${tool.tool}: ${field} must be true when approved`);
      }
    } else if (result.outcome === "retry_capture") {
      if (result.capture_complete !== false) {
        errors.push(`${tool.tool}: retry_capture requires capture_complete=false`);
      }
      for (const field of ["provenance_noise_excluded", "secret_safe"]) {
        if (result[field] !== true) errors.push(`${tool.tool}: ${field} must be true for a safe retry`);
      }
      if (hasChanges(tool.dir)) {
        errors.push(`${tool.tool}: retry_capture is allowed only when ${tool.dir}/ is unchanged`);
      }
    } else {
      errors.push(`${tool.tool}: outcome ${JSON.stringify(result.outcome)} is not publishable`);
    }
  }

  if (expected.length > 0 && approvedCount === 0) {
    errors.push("at least one changed tool must be approved for publication");
  }
  if (errors.length > 0) {
    console.error(`Review validation failed with ${errors.length} error(s):`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log(`Review validation passed for ${expected.length} tool(s).`);
}

main();
