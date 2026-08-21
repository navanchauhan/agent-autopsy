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
const ignoredFixtureRoot = path.join(repoRoot, ".capture-scratch");
fs.mkdirSync(ignoredFixtureRoot, { recursive: true });
const metadataFixtureDir = fs.mkdtempSync(path.join(ignoredFixtureRoot, "review-metadata-"));
const metadataFixtureName = path.relative(repoRoot, metadataFixtureDir);
// `hasChanges` asks git, so a fixture that must look dirty has to live outside
// the ignored scratch tree. This one is created untracked and removed below.
const dirtyFixtureName = "__review-fixture-changed__";
const dirtyFixtureDir = path.join(repoRoot, dirtyFixtureName);
fs.mkdirSync(dirtyFixtureDir, { recursive: true });
fs.writeFileSync(path.join(dirtyFixtureDir, "VERSION"), "version = 2.1.217\n");

const changed = [{
  tool: "claude-code",
  // This path intentionally does not exist, so the retry test remains isolated
  // from unrelated worktree edits made while the suite is running.
  dir: "__review-fixture-unchanged__",
  old_version: "2.1.215",
  new_version: "2.1.217",
}];

function run(review, plan = changed) {
  fs.writeFileSync(changedPath, JSON.stringify(plan));
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
  transport_noise_excluded: true,
  pii_removed: true,
  secret_safe: true,
  issues: [],
};

function approvedResult(tool) {
  return {
    ...retryResult,
    tool,
    outcome: "approve",
    capture_complete: true,
    changes_supported_by_evidence: true,
    inventory_consistent: true,
  };
}

try {
  const approved = run({
    decision: "approve",
    publish_safe: true,
    issues: [],
    tool_results: [approvedResult("claude-code")],
  });
  assert.strictEqual(approved.status, 0, approved.stderr);

  const pinnedSha256 = "a".repeat(64);
  fs.writeFileSync(
    path.join(metadataFixtureDir, "VERSION"),
    `version = 9.8.7\nsha256 = ${pinnedSha256}\n`,
  );
  const shaPlan = [{
    tool: "claude-code",
    dir: metadataFixtureName,
    old_version: "9.8.6",
    new_version: "9.8.7",
    version_field: "version",
    artifact_sha256: pinnedSha256,
  }];
  const matchingSha = run({
    decision: "approve",
    publish_safe: true,
    issues: [],
    tool_results: [approvedResult("claude-code")],
  }, shaPlan);
  assert.strictEqual(matchingSha.status, 0, matchingSha.stderr);

  const wrongSha = run({
    decision: "approve",
    publish_safe: true,
    issues: [],
    tool_results: [approvedResult("claude-code")],
  }, [{ ...shaPlan[0], artifact_sha256: "b".repeat(64) }]);
  assert.notStrictEqual(wrongSha.status, 0, "approved artifact SHA-256 must match the capture plan");
  assert.match(wrongSha.stderr, /VERSION sha256 must equal the pinned artifact SHA-256/);

  const antigravityUrl = "https://example.test/antigravity-1.2.3-linux-x64.tar.gz";
  const antigravitySha512 = "c".repeat(128);
  fs.writeFileSync(
    path.join(metadataFixtureDir, "VERSION"),
    [
      "version = 1.2.3",
      "manifest_version = 1.2.3",
      `manifest_tarball_url = ${antigravityUrl}`,
      `manifest_tarball_sha512 = ${antigravitySha512}`,
      "",
    ].join("\n"),
  );
  const antigravityPlan = [{
    tool: "antigravity",
    dir: metadataFixtureName,
    old_version: "1.2.2",
    new_version: "1.2.3",
    version_field: "version",
    artifact_url: antigravityUrl,
    artifact_sha512: antigravitySha512,
  }];
  const matchingAntigravity = run({
    decision: "approve",
    publish_safe: true,
    issues: [],
    tool_results: [approvedResult("antigravity")],
  }, antigravityPlan);
  assert.strictEqual(matchingAntigravity.status, 0, matchingAntigravity.stderr);

  fs.writeFileSync(
    path.join(metadataFixtureDir, "VERSION"),
    [
      "version = 1.2.3",
      "manifest_version = 1.2.2",
      `manifest_tarball_url = ${antigravityUrl}`,
      `manifest_tarball_sha512 = ${antigravitySha512}`,
      "",
    ].join("\n"),
  );
  const wrongManifestVersion = run({
    decision: "approve",
    publish_safe: true,
    issues: [],
    tool_results: [approvedResult("antigravity")],
  }, antigravityPlan);
  assert.notStrictEqual(
    wrongManifestVersion.status,
    0,
    "approved Antigravity manifest version must match the capture plan",
  );
  assert.match(wrongManifestVersion.stderr, /VERSION manifest_version must equal 1\.2\.3/);

  fs.writeFileSync(
    path.join(metadataFixtureDir, "VERSION"),
    [
      "version = 1.2.3",
      "manifest_version = 1.2.3",
      `manifest_tarball_url = ${antigravityUrl}`,
      `manifest_tarball_sha512 = ${antigravitySha512}`,
      "",
    ].join("\n"),
  );

  const wrongAntigravity = run({
    decision: "approve",
    publish_safe: true,
    issues: [],
    tool_results: [approvedResult("antigravity")],
  }, [{
    ...antigravityPlan[0],
    artifact_url: "https://example.test/different.tar.gz",
    artifact_sha512: "d".repeat(128),
  }]);
  assert.notStrictEqual(
    wrongAntigravity.status,
    0,
    "approved Antigravity manifest metadata must match the capture plan",
  );
  assert.match(wrongAntigravity.stderr, /manifest_tarball_url must equal the pinned artifact URL/);
  assert.match(wrongAntigravity.stderr, /manifest_tarball_sha512 must equal the pinned artifact SHA-512/);

  const safeNoop = run({
    decision: "retry_capture",
    publish_safe: false,
    issues: [{ severity: "error", code: "missing_deferred_capture", message: "retry later" }],
    tool_results: [{
      ...retryResult,
      issues: [{ severity: "error", code: "interactive_capture_unavailable", message: "retry later" }],
    }],
  });
  assert.strictEqual(safeNoop.status, 0, safeNoop.stderr);

  const approvedWithToolError = run({
    decision: "approve",
    publish_safe: true,
    issues: [],
    tool_results: [{
      ...retryResult,
      outcome: "approve",
      capture_complete: true,
      changes_supported_by_evidence: true,
      inventory_consistent: true,
      issues: [{ severity: "error", code: "unsupported_change", message: "do not publish" }],
    }],
  });
  assert.notStrictEqual(approvedWithToolError.status, 0, "approved tool errors must fail validation");
  assert.match(approvedWithToolError.stderr, /approved review cannot contain error issues/);

  fs.writeFileSync(changedPath, JSON.stringify([{ ...changed[0], version_field: "version" }]));
  fs.writeFileSync(reviewPath, JSON.stringify({
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
  }));
  const wrongApprovedVersion = childProcess.spawnSync(
    process.execPath,
    [validator, changedPath, reviewPath],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.notStrictEqual(wrongApprovedVersion.status, 0, "approved VERSION must match capture plan");
  assert.match(wrongApprovedVersion.stderr, /VERSION version must equal 2\.1\.217/);

  const unsafeRetry = run({
    decision: "retry_capture",
    publish_safe: false,
    issues: [],
    tool_results: [{ ...retryResult, secret_safe: false }],
  });
  assert.notStrictEqual(unsafeRetry.status, 0, "unsafe retry must fail validation");
  assert.match(unsafeRetry.stderr, /secret_safe must be true/);

  const piiUnsafeRetry = run({
    decision: "retry_capture",
    publish_safe: false,
    issues: [],
    tool_results: [{ ...retryResult, pii_removed: false }],
  });
  assert.notStrictEqual(piiUnsafeRetry.status, 0, "PII-unsafe retry must fail validation");
  assert.match(piiUnsafeRetry.stderr, /pii_removed must be true/);

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

  // A hold lets one stuck provider block only itself. Before this outcome existed
  // the reviewer had to pick `reject`, which failed the whole run and discarded
  // every other tool's approved work.
  const heldResult = {
    ...retryResult,
    tool: "codex",
    outcome: "hold",
    capture_complete: true,
    issues: [{ severity: "error", code: "version_not_advanced", message: "source advanced" }],
  };
  const twoToolPlan = [
    { ...changed[0], tool: "claude-code" },
    { ...changed[0], tool: "codex", dir: "__review-fixture-unchanged-codex__" },
  ];
  const heldBesideApproval = run({
    decision: "approve",
    publish_safe: true,
    issues: [{ severity: "warning", code: "version_not_advanced", message: "source advanced" }],
    tool_results: [approvedResult("claude-code"), heldResult],
  }, twoToolPlan);
  assert.strictEqual(heldBesideApproval.status, 0, heldBesideApproval.stderr);

  const heldWithIncompleteCapture = run({
    decision: "approve",
    publish_safe: true,
    issues: [],
    tool_results: [approvedResult("claude-code"), { ...heldResult, capture_complete: false }],
  }, twoToolPlan);
  assert.notStrictEqual(heldWithIncompleteCapture.status, 0, "an incomplete capture must retry, not hold");
  assert.match(heldWithIncompleteCapture.stderr, /hold requires capture_complete=true/);

  const unsafeHold = run({
    decision: "approve",
    publish_safe: true,
    issues: [],
    tool_results: [approvedResult("claude-code"), { ...heldResult, pii_removed: false }],
  }, twoToolPlan);
  assert.notStrictEqual(unsafeHold.status, 0, "an unsafe hold must fail validation");
  assert.match(unsafeHold.stderr, /pii_removed must be true for a hold/);

  const heldChangedDirectory = run({
    decision: "approve",
    publish_safe: true,
    issues: [],
    tool_results: [approvedResult("claude-code"), { ...heldResult, tool: "antigravity" }],
  }, [twoToolPlan[0], { ...changed[0], tool: "antigravity", dir: dirtyFixtureName }]);
  assert.notStrictEqual(heldChangedDirectory.status, 0, "a hold must leave its directory unchanged");
  assert.match(heldChangedDirectory.stderr, /hold is allowed only when .* is unchanged/);

  const holdBesideRetry = run({
    decision: "retry_capture",
    publish_safe: false,
    issues: [],
    tool_results: [retryResult, heldResult],
  }, twoToolPlan);
  assert.strictEqual(holdBesideRetry.status, 0, holdBesideRetry.stderr);

  const allHold = run({
    decision: "retry_capture",
    publish_safe: false,
    issues: [],
    tool_results: [{ ...heldResult, tool: "claude-code" }, heldResult],
  }, twoToolPlan);
  assert.notStrictEqual(allHold.status, 0, "an all-hold review must not request a recapture");
  assert.match(allHold.stderr, /requires at least one retry_capture/);

  console.log("validate-review regression tests passed");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(metadataFixtureDir, { recursive: true, force: true });
  fs.rmSync(dirtyFixtureDir, { recursive: true, force: true });
}
