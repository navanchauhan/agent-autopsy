#!/usr/bin/env node

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const validator = path.join(repoRoot, ".github", "scripts", "validate-review.cjs");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-autopsy-review-"));
const changedPath = path.join(tempDir, "changed.json");
const reviewPath = path.join(tempDir, "review.json");

const changed = [{
  tool: "claude-code",
  dir: "claude-code",
  old_version: "2.1.215",
  new_version: "2.1.217",
}];

function run(review) {
  fs.writeFileSync(changedPath, JSON.stringify(changed));
  fs.writeFileSync(reviewPath, JSON.stringify(review));
  return childProcess.spawnSync(process.execPath, [validator, changedPath, reviewPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

const retryResult = {
  tool: "claude-code",
  outcome: "retry_capture",
  capture_complete: false,
  changes_supported_by_evidence: false,
  inventory_consistent: false,
  provenance_noise_excluded: true,
  secret_safe: true,
  issues: [],
};

try {
  const approved = run({
    decision: "approve",
    publish_safe: true,
    issues: [],
    tool_results: [{
      ...retryResult,
      outcome: "approve",
      capture_complete: true,
      changes_supported_by_evidence: true,
      inventory_consistent: true,
    }],
  });
  assert.strictEqual(approved.status, 0, approved.stderr);

  const safeNoop = run({
    decision: "retry_capture",
    publish_safe: false,
    issues: [{ severity: "error", code: "missing_deferred_capture", message: "retry later" }],
    tool_results: [retryResult],
  });
  assert.strictEqual(safeNoop.status, 0, safeNoop.stderr);

  const unsafeRetry = run({
    decision: "retry_capture",
    publish_safe: false,
    issues: [],
    tool_results: [{ ...retryResult, secret_safe: false }],
  });
  assert.notStrictEqual(unsafeRetry.status, 0, "unsafe retry must fail validation");
  assert.match(unsafeRetry.stderr, /secret_safe must be true/);

  const mismatchedDecision = run({
    decision: "retry_capture",
    publish_safe: false,
    issues: [],
    tool_results: [{
      ...retryResult,
      outcome: "approve",
      capture_complete: true,
      changes_supported_by_evidence: true,
      inventory_consistent: true,
    }],
  });
  assert.notStrictEqual(mismatchedDecision.status, 0, "retry decision cannot publish an approval");
  assert.match(mismatchedDecision.stderr, /safe retry requires every changed tool/);

  console.log("validate-review regression tests passed");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
