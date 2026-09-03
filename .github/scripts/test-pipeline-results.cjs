#!/usr/bin/env node

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const scripts = path.join(repoRoot, ".github", "scripts");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-autopsy-pipeline-"));

function run(script, args, options = {}) {
  return childProcess.spawnSync(process.execPath, [path.join(scripts, script), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

try {
  const plan = [
    { tool: "codex", dir: "codex", old_version: "1.0.0", new_version: "2.0.0", capture_contract_hash: "a".repeat(64), plan_hash: "1".repeat(64) },
    { tool: "grok", dir: "grok", old_version: "1.0.0", new_version: "2.0.0", capture_contract_hash: "b".repeat(64), plan_hash: "2".repeat(64) },
  ];
  const planPath = path.join(temp, "plan.json");
  const captureRoot = path.join(temp, "capture-output");
  const readyPath = path.join(temp, "ready.json");
  const retryPath = path.join(temp, "retry.json");
  fs.writeFileSync(planPath, JSON.stringify(plan));
  fs.mkdirSync(path.join(captureRoot, "codex", "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(captureRoot, "codex", "result.json"),
    JSON.stringify({ tool: "codex", target_version: "2.0.0", status: "captured", message: "complete", capture_contract_hash: "a".repeat(64), plan_hash: "1".repeat(64) }),
  );
  const codexEvidence = Buffer.from("safe evidence\n");
  fs.writeFileSync(path.join(captureRoot, "codex", "evidence", "source.txt"), codexEvidence);
  fs.writeFileSync(
    path.join(captureRoot, "codex", "evidence", "evidence-manifest.json"),
    JSON.stringify({
      tool: "codex",
      total_bytes: codexEvidence.length,
      files: [{
        path: "source.txt",
        bytes: codexEvidence.length,
        sha256: sha256(codexEvidence),
      }],
    }),
  );
  fs.mkdirSync(path.join(captureRoot, "grok"), { recursive: true });
  fs.writeFileSync(
    path.join(captureRoot, "grok", "result.json"),
    JSON.stringify({ tool: "grok", target_version: "2.0.0", status: "retry_capture", message: "auth unavailable", capture_contract_hash: "b".repeat(64), plan_hash: "2".repeat(64) }),
  );

  const selected = run("select-capture-results.cjs", [planPath, captureRoot, readyPath, retryPath]);
  assert.equal(selected.status, 0, selected.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(readyPath)), [plan[0]]);
  assert.equal(JSON.parse(fs.readFileSync(retryPath))[0].tool, "grok");
  assert.equal(JSON.parse(fs.readFileSync(path.join(captureRoot, "evidence-index.json")))[0].tool, "codex");

  // Deferred results are reduced to their trusted result record so evidence or
  // arbitrary provider output cannot cross the cache/artifact boundary.
  fs.mkdirSync(path.join(captureRoot, "grok", "evidence"));
  fs.writeFileSync(path.join(captureRoot, "grok", "evidence", "unverified.txt"), "must be removed\n");
  fs.writeFileSync(path.join(captureRoot, "grok", "extra.txt"), "must be removed\n");
  const sanitizedRetry = run("select-capture-results.cjs", [planPath, captureRoot, readyPath, retryPath]);
  assert.equal(sanitizedRetry.status, 0, sanitizedRetry.stderr);
  assert.deepEqual(fs.readdirSync(path.join(captureRoot, "grok")), ["result.json"]);
  assert.equal(JSON.parse(fs.readFileSync(retryPath)).find((entry) => entry.tool === "grok").status, "retry_capture");

  const codexManifestPath = path.join(captureRoot, "codex", "evidence", "evidence-manifest.json");
  const originalCodexManifest = JSON.parse(fs.readFileSync(codexManifestPath, "utf8"));

  // Both manifest levels are closed schemas; extra metadata must not be
  // trusted merely because all listed file hashes happen to match.
  fs.writeFileSync(codexManifestPath, JSON.stringify({ ...originalCodexManifest, generated_at: "untrusted" }));
  const extraManifestField = run("select-capture-results.cjs", [planPath, captureRoot, readyPath, retryPath]);
  assert.equal(extraManifestField.status, 0, extraManifestField.stderr);
  assert.equal(JSON.parse(fs.readFileSync(retryPath)).find((entry) => entry.tool === "codex").status, "invalid_evidence");

  const extraRecordManifest = structuredClone(originalCodexManifest);
  extraRecordManifest.files[0].source = "provider";
  fs.writeFileSync(codexManifestPath, JSON.stringify(extraRecordManifest));
  const extraRecordField = run("select-capture-results.cjs", [planPath, captureRoot, readyPath, retryPath]);
  assert.equal(extraRecordField.status, 0, extraRecordField.stderr);
  assert.equal(JSON.parse(fs.readFileSync(retryPath)).find((entry) => entry.tool === "codex").status, "invalid_evidence");

  // Normalizing key spelling closes snake_case/camelCase bypasses in both the
  // producer and the immutable host verifier.
  const credentialEvidence = Buffer.from(JSON.stringify({ refreshToken: "opaque-credential-value" }));
  fs.rmSync(path.join(captureRoot, "codex", "evidence", "source.txt"));
  fs.writeFileSync(path.join(captureRoot, "codex", "evidence", "source.json"), credentialEvidence);
  fs.writeFileSync(codexManifestPath, JSON.stringify({
    tool: "codex",
    total_bytes: credentialEvidence.length,
    files: [{ path: "source.json", bytes: credentialEvidence.length, sha256: sha256(credentialEvidence) }],
  }));
  const camelCaseSelection = run("select-capture-results.cjs", [planPath, captureRoot, readyPath, retryPath]);
  assert.equal(camelCaseSelection.status, 0, camelCaseSelection.stderr);
  assert.match(
    JSON.parse(fs.readFileSync(retryPath)).find((entry) => entry.tool === "codex").message,
    /credential-shaped value/,
  );

  fs.rmSync(path.join(captureRoot, "codex", "evidence", "source.json"));
  fs.writeFileSync(path.join(captureRoot, "codex", "evidence", "source.txt"), codexEvidence);
  fs.writeFileSync(codexManifestPath, JSON.stringify(originalCodexManifest));

  fs.writeFileSync(path.join(captureRoot, "codex", "unexpected.txt"), "not part of the bundle\n");
  const extraRootEntry = run("select-capture-results.cjs", [planPath, captureRoot, readyPath, retryPath]);
  assert.equal(extraRootEntry.status, 0, extraRootEntry.stderr);
  assert.match(
    JSON.parse(fs.readFileSync(retryPath)).find((entry) => entry.tool === "codex").message,
    /must contain exactly/,
  );
  fs.rmSync(path.join(captureRoot, "codex", "unexpected.txt"));

  // Symlinks are rejected even when they occupy a manifest-listed path. Some
  // Windows configurations disallow creating test symlinks, so exercise this
  // assertion whenever the host permits it (Linux CI always does).
  const codexSourcePath = path.join(captureRoot, "codex", "evidence", "source.txt");
  const symlinkTarget = path.join(temp, "symlink-target.txt");
  fs.writeFileSync(symlinkTarget, codexEvidence);
  fs.rmSync(codexSourcePath);
  let symlinkCreated = false;
  try {
    fs.symlinkSync(symlinkTarget, codexSourcePath, "file");
    symlinkCreated = true;
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
  }
  if (symlinkCreated) {
    const symlinkSelection = run("select-capture-results.cjs", [planPath, captureRoot, readyPath, retryPath]);
    assert.equal(symlinkSelection.status, 0, symlinkSelection.stderr);
    assert.match(
      JSON.parse(fs.readFileSync(retryPath)).find((entry) => entry.tool === "codex").message,
      /not a regular file|symbolic link/,
    );
    fs.rmSync(codexSourcePath);
  }
  fs.writeFileSync(codexSourcePath, codexEvidence);

  const reviewPath = path.join(temp, "review.json");
  const summaryPath = path.join(temp, "summary.md");
  const driverOutput = path.join(temp, "driver-output");
  const captureRetriesPath = path.join(temp, "capture-retries.json");
  const driverInputPath = path.join(temp, "driver-input.json");
  fs.writeFileSync(captureRetriesPath, "[]\n");
  fs.writeFileSync(driverInputPath, JSON.stringify({
    schema_version: 1,
    input_hash: "9".repeat(64),
    retry_bucket: 1,
    per_tool: { codex: "7".repeat(64), grok: "8".repeat(64) },
  }));
  fs.writeFileSync(summaryPath, "## codex\nCodex changed.\n\n## grok\nGrok deferred.\n");
  fs.writeFileSync(reviewPath, JSON.stringify({
    decision: "approve",
    publish_safe: true,
    issues: [],
    tool_results: [
      { tool: "codex", outcome: "approve", issues: [] },
      { tool: "grok", outcome: "retry_capture", issues: [] },
    ],
  }));
  const largeSurfaceObservations = Buffer.from(JSON.stringify({
    schema_version: 1,
    provider: "codex",
    authority: "model-request",
    padding: "x".repeat(1024 * 1024),
  }));
  fs.writeFileSync(
    path.join(captureRoot, "codex", "evidence", "surface-observations.json"),
    largeSurfaceObservations,
  );
  const rawRequest = Buffer.from(JSON.stringify({ request: "must not enter the publish bundle" }));
  fs.writeFileSync(
    path.join(captureRoot, "codex", "evidence", "raw-request.json"),
    rawRequest,
  );
  fs.writeFileSync(codexManifestPath, JSON.stringify({
    tool: "codex",
    total_bytes: codexEvidence.length + largeSurfaceObservations.length + rawRequest.length,
    files: [
      { path: "source.txt", bytes: codexEvidence.length, sha256: sha256(codexEvidence) },
      {
        path: "surface-observations.json",
        bytes: largeSurfaceObservations.length,
        sha256: sha256(largeSurfaceObservations),
      },
      { path: "raw-request.json", bytes: rawRequest.length, sha256: sha256(rawRequest) },
    ],
  }));
  const prepared = run("prepare-driver-output.cjs", [planPath, reviewPath, summaryPath, driverOutput, captureRetriesPath], {
    env: {
      ...process.env,
      DRIVER_INPUT_MANIFEST: driverInputPath,
      CAPTURE_SCRATCH_DIR: captureRoot,
    },
  });
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(driverOutput, "changed-tools.json"))), [plan[0]]);
  assert.match(fs.readFileSync(path.join(driverOutput, "codex-summary.md"), "utf8"), /Codex changed/);
  assert.doesNotMatch(fs.readFileSync(path.join(driverOutput, "codex-summary.md"), "utf8"), /Grok deferred/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(driverOutput, "retry-report.json")))[0].review_input_hash, "8".repeat(64));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(driverOutput, "result.json"))).retry_tools, ["grok"]);
  assert.ok(fs.existsSync(path.join(
    driverOutput, "validation-evidence", "codex", "evidence", "surface-observations.json",
  )));
  assert.equal(fs.existsSync(path.join(
    driverOutput, "validation-evidence", "codex", "evidence", "raw-request.json",
  )), false);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(driverOutput, "validation-evidence", "manifest.json"))).files,
    [{
      path: "codex/evidence/surface-observations.json",
      bytes: largeSurfaceObservations.length,
      sha256: sha256(largeSurfaceObservations),
    }],
  );

  // A held tool is reported alongside retries but never asks for a new capture,
  // so it must stay out of `retry_tools`.
  const heldReviewPath = path.join(temp, "review-hold.json");
  const heldOutput = path.join(temp, "driver-output-hold");
  fs.writeFileSync(heldReviewPath, JSON.stringify({
    decision: "approve",
    publish_safe: true,
    issues: [],
    tool_results: [
      { tool: "codex", outcome: "approve", issues: [] },
      { tool: "grok", outcome: "hold", issues: [] },
    ],
  }));
  const preparedHold = run(
    "prepare-driver-output.cjs",
    [planPath, heldReviewPath, summaryPath, heldOutput, captureRetriesPath],
    { env: {
      ...process.env,
      DRIVER_INPUT_MANIFEST: driverInputPath,
      CAPTURE_SCRATCH_DIR: captureRoot,
    } },
  );
  assert.equal(preparedHold.status, 0, preparedHold.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(heldOutput, "result.json"))).retry_tools, []);
  const heldReport = JSON.parse(fs.readFileSync(path.join(heldOutput, "retry-report.json")));
  assert.deepEqual(heldReport.map((entry) => [entry.tool, entry.outcome]), [["grok", "hold"]]);
  assert.match(preparedHold.stdout, /1 approved, 0 deferred, 1 held/);

  const evidenceSource = path.join(temp, "evidence-source");
  const evidenceOut = path.join(temp, "evidence-out");
  fs.mkdirSync(evidenceSource);
  fs.writeFileSync(path.join(evidenceSource, "capture.json"), JSON.stringify({ headers: { authorization: "***" }, body: "safe" }));
  const evidence = run("prepare-capture-output.cjs", ["codex", evidenceSource, evidenceOut]);
  assert.equal(evidence.status, 0, evidence.stderr);
  assert.ok(fs.existsSync(path.join(evidenceOut, "evidence-manifest.json")));

  fs.writeFileSync(path.join(evidenceSource, "capture.json"), JSON.stringify({ accessToken: "opaque-credential-value" }));
  const camelCaseEvidence = run("prepare-capture-output.cjs", ["codex", evidenceSource, evidenceOut]);
  assert.notEqual(camelCaseEvidence.status, 0, "camelCase credential keys must fail closed");

  fs.writeFileSync(path.join(evidenceSource, "capture.json"), JSON.stringify({
    request: {
      body: JSON.stringify({ refresh_token: "nested-opaque-credential-value" }),
    },
  }));
  const serializedCredential = run("prepare-capture-output.cjs", ["codex", evidenceSource, evidenceOut]);
  assert.notEqual(serializedCredential.status, 0, "serialized request bodies containing credentials must fail closed");

  fs.writeFileSync(path.join(evidenceSource, "capture.json"), Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]));
  const invalidUtf8Evidence = run("prepare-capture-output.cjs", ["codex", evidenceSource, evidenceOut]);
  assert.notEqual(invalidUtf8Evidence.status, 0, "invalid UTF-8 evidence must fail closed");

  fs.writeFileSync(path.join(evidenceSource, "capture.json"), JSON.stringify({ body: "safe" }));
  fs.writeFileSync(path.join(evidenceSource, "evidence-manifest.json"), "{}\n");
  const reservedManifest = run("prepare-capture-output.cjs", ["codex", evidenceSource, evidenceOut]);
  assert.notEqual(reservedManifest.status, 0, "provider-supplied evidence manifests must be rejected");
  fs.rmSync(path.join(evidenceSource, "evidence-manifest.json"));

  const sourceSymlinkTarget = path.join(temp, "source-symlink-target.txt");
  const sourceSymlink = path.join(evidenceSource, "linked.txt");
  fs.writeFileSync(sourceSymlinkTarget, "safe\n");
  let sourceSymlinkCreated = false;
  try {
    fs.symlinkSync(sourceSymlinkTarget, sourceSymlink, "file");
    sourceSymlinkCreated = true;
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
  }
  if (sourceSymlinkCreated) {
    const symlinkEvidence = run("prepare-capture-output.cjs", ["codex", evidenceSource, evidenceOut]);
    assert.notEqual(symlinkEvidence.status, 0, "symbolic-link evidence must be rejected");
    fs.rmSync(sourceSymlink);
  }

  fs.writeFileSync(path.join(evidenceSource, "capture.json"), JSON.stringify({ authorization: "Bearer secret-token-value-12345678901234567890" }));
  const unsafeEvidence = run("prepare-capture-output.cjs", ["codex", evidenceSource, evidenceOut]);
  assert.notEqual(unsafeEvidence.status, 0, "unredacted authorization evidence must fail");

  fs.writeFileSync(path.join(evidenceSource, "capture.json"), Buffer.from("safe\0hidden"));
  const binaryEvidence = run("prepare-capture-output.cjs", ["codex", evidenceSource, evidenceOut]);
  assert.notEqual(binaryEvidence.status, 0, "NUL-bearing text evidence must fail closed");

  const integrityPlanPath = path.join(temp, "integrity-plan.json");
  const integrityRoot = path.join(temp, "integrity-output");
  const integrityReady = path.join(temp, "integrity-ready.json");
  const integrityRetry = path.join(temp, "integrity-retry.json");
  const integrityPlan = [
    { tool: "codex", dir: "codex", new_version: "2.0.0", capture_contract_hash: "a".repeat(64), plan_hash: "1".repeat(64) },
    { tool: "claude-code", dir: "claude-code", new_version: "2.0.0", capture_contract_hash: "c".repeat(64), plan_hash: "3".repeat(64) },
  ];
  fs.writeFileSync(integrityPlanPath, JSON.stringify(integrityPlan));
  for (const entry of integrityPlan) {
    const sourceDir = path.join(temp, `integrity-source-${entry.tool}`);
    const outputDir = path.join(integrityRoot, entry.tool, "evidence");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "capture.txt"), `${entry.tool} evidence\n`);
    assert.equal(run("prepare-capture-output.cjs", [entry.tool, sourceDir, outputDir]).status, 0);
    fs.mkdirSync(path.join(integrityRoot, entry.tool), { recursive: true });
    fs.writeFileSync(path.join(integrityRoot, entry.tool, "result.json"), JSON.stringify({
      tool: entry.tool,
      target_version: entry.new_version,
      status: "captured",
      message: "complete",
      capture_contract_hash: entry.capture_contract_hash,
      plan_hash: entry.plan_hash,
    }));
  }
  fs.appendFileSync(path.join(integrityRoot, "codex", "evidence", "capture.txt"), "tampered\n");
  const integritySelection = run("select-capture-results.cjs", [
    integrityPlanPath,
    integrityRoot,
    integrityReady,
    integrityRetry,
  ]);
  assert.equal(integritySelection.status, 0, integritySelection.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(integrityReady)), [integrityPlan[1]]);
  assert.equal(JSON.parse(fs.readFileSync(integrityRetry))[0].status, "invalid_evidence");

  // The driver transports a patch rather than a directory overlay so deletes
  // and new files survive the artifact boundary.
  const patchRepo = path.join(temp, "patch-repo");
  const appliedRepo = path.join(temp, "applied-repo");
  fs.mkdirSync(patchRepo);
  childProcess.execFileSync("git", ["init", "-q"], { cwd: patchRepo });
  childProcess.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: patchRepo });
  childProcess.execFileSync("git", ["config", "user.name", "Pipeline Test"], { cwd: patchRepo });
  childProcess.execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: patchRepo });
  fs.writeFileSync(path.join(patchRepo, "removed.txt"), "old\n");
  fs.writeFileSync(path.join(patchRepo, "changed.txt"), "before\n");
  childProcess.execFileSync("git", ["add", "removed.txt", "changed.txt"], { cwd: patchRepo });
  childProcess.execFileSync("git", ["commit", "-qm", "base"], { cwd: patchRepo });
  fs.rmSync(path.join(patchRepo, "removed.txt"));
  fs.writeFileSync(path.join(patchRepo, "changed.txt"), "after\n");
  fs.writeFileSync(path.join(patchRepo, "added.txt"), "new\n");
  childProcess.execFileSync("git", ["add", "-N", "--", "."], { cwd: patchRepo });
  const candidatePatch = childProcess.execFileSync(
    "git",
    ["diff", "--binary", "--full-index", "--no-ext-diff", "HEAD", "--", "."],
    { cwd: patchRepo },
  );
  childProcess.execFileSync("git", ["-c", "core.autocrlf=false", "clone", "-q", patchRepo, appliedRepo]);
  childProcess.execFileSync("git", ["apply", "-"], { cwd: appliedRepo, input: candidatePatch });
  assert.equal(fs.existsSync(path.join(appliedRepo, "removed.txt")), false);
  assert.equal(fs.readFileSync(path.join(appliedRepo, "changed.txt"), "utf8").replaceAll("\r\n", "\n"), "after\n");
  assert.equal(fs.readFileSync(path.join(appliedRepo, "added.txt"), "utf8").replaceAll("\r\n", "\n"), "new\n");

  const publishRepo = path.join(temp, "publish-repo");
  const publishBundle = path.join(temp, "publish-bundle");
  fs.mkdirSync(path.join(publishRepo, "codex"), { recursive: true });
  fs.mkdirSync(path.join(publishRepo, "codex", "prompts"), { recursive: true });
  fs.mkdirSync(path.join(publishRepo, "codex", "misc", "scripts"), { recursive: true });
  fs.mkdirSync(publishBundle);
  childProcess.execFileSync("git", ["init", "-q"], { cwd: publishRepo });
  childProcess.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: publishRepo });
  childProcess.execFileSync("git", ["config", "user.name", "Pipeline Test"], { cwd: publishRepo });
  fs.writeFileSync(path.join(publishRepo, "codex", "VERSION"), "codex_cli_package_version = 1.0.0\n");
  fs.writeFileSync(path.join(publishRepo, "codex", "prompts", "default.md"), "before\n");
  fs.writeFileSync(path.join(publishRepo, "codex", "misc", "runtime.txt"), "normalized data\n");
  fs.writeFileSync(path.join(publishRepo, "codex", "misc", "scripts", "capture.sh"), "#!/bin/sh\n");
  childProcess.execFileSync("git", ["add", "."], { cwd: publishRepo });
  childProcess.execFileSync("git", ["commit", "-qm", "base"], { cwd: publishRepo });
  const publishBaseSha = childProcess.execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: publishRepo,
    encoding: "utf8",
  }).trim();
  fs.writeFileSync(path.join(publishRepo, "codex", "prompts", "default.md"), "after\n");
  const safePublishPatch = childProcess.execFileSync(
    "git", ["diff", "--binary", "--full-index", "--no-renames", "HEAD", "--", "codex"], { cwd: publishRepo },
  );
  childProcess.execFileSync("git", ["restore", "--worktree", "--", "codex/prompts/default.md"], { cwd: publishRepo });
  const publishPlan = [{
    tool: "codex",
    dir: "codex",
    old_version: "1.0.0",
    new_version: "1.0.1",
    plan_hash: "a".repeat(64),
  }];
  fs.writeFileSync(path.join(publishBundle, "changed-tools.json"), JSON.stringify(publishPlan));
  fs.writeFileSync(path.join(publishBundle, "result.json"), JSON.stringify({
    has_publishable: true,
    base_sha: publishBaseSha,
    approved_tools: ["codex"],
  }));
  fs.writeFileSync(path.join(publishBundle, "review-result.json"), JSON.stringify({
    decision: "approve",
    publish_safe: true,
    tool_results: [{ tool: "codex", outcome: "approve", pii_removed: true }],
  }));
  fs.writeFileSync(path.join(publishBundle, "base-sha.txt"), `${publishBaseSha}\n`);
  fs.writeFileSync(path.join(publishBundle, "codex-summary.md"), "## codex\nSafe update.\n");
  fs.writeFileSync(path.join(publishBundle, "retry-report.json"), "[]\n");
  fs.writeFileSync(path.join(publishBundle, "capture-retries.json"), "[]\n");
  fs.writeFileSync(path.join(publishBundle, "candidate.patch"), safePublishPatch);
  fs.mkdirSync(path.join(publishBundle, "validation-evidence", "codex", "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(publishBundle, "validation-evidence", "codex", "evidence", "surface-observations.json"),
    JSON.stringify({ schema_version: 1, provider: "codex", authority: "model-request" }),
  );
  const publishEvidence = fs.readFileSync(
    path.join(publishBundle, "validation-evidence", "codex", "evidence", "surface-observations.json"),
  );
  fs.writeFileSync(
    path.join(publishBundle, "validation-evidence", "manifest.json"),
    JSON.stringify({
      schema_version: 1,
      files: [{
        path: "codex/evidence/surface-observations.json",
        bytes: publishEvidence.length,
        sha256: sha256(publishEvidence),
      }],
    }),
  );
  const safePublish = run("validate-publish-bundle.cjs", [publishBundle], { cwd: publishRepo });
  assert.equal(safePublish.status, 0, safePublish.stderr);

  fs.appendFileSync(
    path.join(publishBundle, "validation-evidence", "codex", "evidence", "surface-observations.json"),
    " ",
  );
  const changedPublishEvidence = run("validate-publish-bundle.cjs", [publishBundle], { cwd: publishRepo });
  assert.notEqual(changedPublishEvidence.status, 0, "publication evidence must match its exact manifest digest");
  fs.writeFileSync(
    path.join(publishBundle, "validation-evidence", "codex", "evidence", "surface-observations.json"),
    publishEvidence,
  );

  fs.writeFileSync(path.join(publishBundle, "review-result.json"), JSON.stringify({
    decision: "approve",
    publish_safe: true,
    tool_results: [{ tool: "codex", outcome: "approve", pii_removed: false }],
  }));
  const piiUnreviewed = run("validate-publish-bundle.cjs", [publishBundle], { cwd: publishRepo });
  assert.notEqual(piiUnreviewed.status, 0, "publication must require the agent PII-removal attestation");
  fs.writeFileSync(path.join(publishBundle, "review-result.json"), JSON.stringify({
    decision: "approve",
    publish_safe: true,
    tool_results: [{ tool: "codex", outcome: "approve", pii_removed: true }],
  }));

  fs.writeFileSync(path.join(publishBundle, "base-sha.txt"), `${"f".repeat(40)}\n`);
  fs.writeFileSync(path.join(publishBundle, "result.json"), JSON.stringify({
    has_publishable: true,
    base_sha: "f".repeat(40),
    approved_tools: ["codex"],
  }));
  const movedBase = run("validate-publish-bundle.cjs", [publishBundle], { cwd: publishRepo });
  assert.notEqual(movedBase.status, 0, "publish bundle must be bound to the exact reviewed base SHA");
  fs.writeFileSync(path.join(publishBundle, "base-sha.txt"), `${publishBaseSha}\n`);
  fs.writeFileSync(path.join(publishBundle, "result.json"), JSON.stringify({
    has_publishable: true,
    base_sha: publishBaseSha,
    approved_tools: ["codex"],
  }));

  const captureScript = path.join(publishRepo, "codex", "misc", "scripts", "capture.sh");
  fs.writeFileSync(captureScript, "#!/bin/sh\necho poisoned\n");
  const poisonedCapturePatch = childProcess.execFileSync(
    "git", ["diff", "--binary", "--full-index", "--no-renames", "HEAD", "--", "codex/misc/scripts/capture.sh"],
    { cwd: publishRepo },
  );
  childProcess.execFileSync("git", ["restore", "--worktree", "--", "codex/misc/scripts/capture.sh"], { cwd: publishRepo });
  fs.writeFileSync(path.join(publishBundle, "candidate.patch"), poisonedCapturePatch);
  const poisonedCapture = run("validate-publish-bundle.cjs", [publishBundle], { cwd: publishRepo });
  assert.notEqual(poisonedCapture.status, 0, "publish bundle must not modify credential-bearing capture scripts");

  fs.writeFileSync(path.join(publishRepo, "outside.txt"), "escape\n");
  childProcess.execFileSync("git", ["add", "-N", "--", "outside.txt"], { cwd: publishRepo });
  const unsafePublishPatch = childProcess.execFileSync(
    "git", ["diff", "--binary", "--full-index", "--no-renames", "HEAD", "--", "outside.txt"], { cwd: publishRepo },
  );
  fs.rmSync(path.join(publishRepo, "outside.txt"));
  fs.writeFileSync(path.join(publishBundle, "candidate.patch"), unsafePublishPatch);
  const unsafePublish = run("validate-publish-bundle.cjs", [publishBundle], { cwd: publishRepo });
  assert.notEqual(unsafePublish.status, 0, "publish bundle must reject paths outside approved tool directories");

  fs.writeFileSync(path.join(publishRepo, "codex", "README.md"), "unreviewed instructions\n");
  childProcess.execFileSync("git", ["add", "-N", "--", "codex/README.md"], { cwd: publishRepo });
  const readmePatch = childProcess.execFileSync(
    "git", ["diff", "--binary", "--full-index", "--no-renames", "HEAD", "--", "codex/README.md"],
    { cwd: publishRepo },
  );
  childProcess.execFileSync("git", ["reset", "-q", "--", "codex/README.md"], { cwd: publishRepo });
  fs.rmSync(path.join(publishRepo, "codex", "README.md"));
  fs.writeFileSync(path.join(publishBundle, "candidate.patch"), readmePatch);
  const readmePublish = run("validate-publish-bundle.cjs", [publishBundle], { cwd: publishRepo });
  assert.notEqual(readmePublish.status, 0, "publish bundle must reject tool documentation changes");

  childProcess.execFileSync("git", ["update-index", "--chmod=+x", "--", "codex/misc/runtime.txt"], { cwd: publishRepo });
  const executablePatch = childProcess.execFileSync(
    "git", ["diff", "--cached", "--binary", "--full-index", "--no-renames", "HEAD", "--", "codex/misc/runtime.txt"],
    { cwd: publishRepo },
  );
  childProcess.execFileSync("git", ["reset", "-q", "HEAD", "--", "codex/misc/runtime.txt"], { cwd: publishRepo });
  fs.writeFileSync(path.join(publishBundle, "candidate.patch"), executablePatch);
  const executablePublish = run("validate-publish-bundle.cjs", [publishBundle], { cwd: publishRepo });
  assert.notEqual(executablePublish.status, 0, "publish bundle must reject executable normalized artifacts");

  // Unrelated publications must not invalidate a deferred tool's deterministic
  // driver cache. Relevant tool-tree and driver-contract changes still must.
  const driverIdentityRepo = path.join(temp, "driver-identity-repo");
  fs.mkdirSync(path.join(driverIdentityRepo, "codex"), { recursive: true });
  fs.cpSync(path.join(repoRoot, ".github"), path.join(driverIdentityRepo, ".github"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "Dockerfile"), path.join(driverIdentityRepo, "Dockerfile"));
  fs.writeFileSync(path.join(driverIdentityRepo, "codex", "VERSION"), "version = 1.0.0\n");
  childProcess.execFileSync("git", ["init", "-q"], { cwd: driverIdentityRepo });
  childProcess.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: driverIdentityRepo });
  childProcess.execFileSync("git", ["config", "user.name", "Pipeline Test"], { cwd: driverIdentityRepo });
  childProcess.execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: driverIdentityRepo });
  childProcess.execFileSync("git", ["add", "--", "Dockerfile", ".github", "codex"], { cwd: driverIdentityRepo });
  childProcess.execFileSync("git", ["commit", "-qm", "baseline"], { cwd: driverIdentityRepo });

  const driverStateDir = path.join(driverIdentityRepo, ".test-state");
  const driverReadyPath = path.join(driverStateDir, "ready.json");
  const driverEvidencePath = path.join(driverStateDir, "evidence.json");
  const driverOutputPath = path.join(driverStateDir, "github-output.txt");
  fs.mkdirSync(driverStateDir);
  fs.writeFileSync(driverReadyPath, JSON.stringify([{
    tool: "codex",
    dir: "codex",
    old_version: "1.0.0",
    new_version: "1.0.1",
    capture_contract_hash: "a".repeat(64),
    plan_hash: "b".repeat(64),
  }]));
  fs.writeFileSync(driverEvidencePath, JSON.stringify([{
    tool: "codex",
    target_version: "1.0.1",
    files: [{ path: "source.txt", bytes: 5, sha256: "c".repeat(64) }],
  }]));

  function computeDriverHash() {
    fs.writeFileSync(driverOutputPath, "");
    const result = run("compute-driver-input.cjs", [driverReadyPath, driverEvidencePath], {
      cwd: driverIdentityRepo,
      env: {
        ...process.env,
        GITHUB_OUTPUT: driverOutputPath,
        CODEX_REFRESH_MODEL: "author-model",
        CODEX_REFRESH_REASONING_EFFORT: "medium",
        CODEX_REVIEW_MODEL: "review-model",
        CODEX_REVIEW_REASONING_EFFORT: "medium",
        CODEX_DRIVER_VERSION: "1.2.3",
        DRIVER_RETRY_BUCKET_HOURS: "24",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const match = fs.readFileSync(driverOutputPath, "utf8").match(/^input_hash=([0-9a-f]{64})$/m);
    assert.ok(match, "compute-driver-input must emit a SHA-256 input hash");
    return match[1];
  }

  const baselineDriverHash = computeDriverHash();
  fs.writeFileSync(path.join(driverIdentityRepo, "unrelated.txt"), "unrelated publication\n");
  childProcess.execFileSync("git", ["add", "--", "unrelated.txt"], { cwd: driverIdentityRepo });
  childProcess.execFileSync("git", ["commit", "-qm", "unrelated publication"], { cwd: driverIdentityRepo });
  assert.equal(
    computeDriverHash(),
    baselineDriverHash,
    "an unrelated commit must preserve the driver input identity",
  );

  fs.writeFileSync(path.join(driverIdentityRepo, "codex", "VERSION"), "version = 1.0.0\nstate = changed\n");
  childProcess.execFileSync("git", ["add", "--", "codex/VERSION"], { cwd: driverIdentityRepo });
  childProcess.execFileSync("git", ["commit", "-qm", "change planned tool baseline"], { cwd: driverIdentityRepo });
  const changedTreeDriverHash = computeDriverHash();
  assert.notEqual(
    changedTreeDriverHash,
    baselineDriverHash,
    "a planned tool baseline change must invalidate the driver input identity",
  );

  fs.appendFileSync(
    path.join(driverIdentityRepo, ".github", "scripts", "hash-candidate.sh"),
    "\n# driver contract changed\n",
  );
  childProcess.execFileSync("git", ["add", "--", ".github/scripts/hash-candidate.sh"], { cwd: driverIdentityRepo });
  childProcess.execFileSync("git", ["commit", "-qm", "change driver contract"], { cwd: driverIdentityRepo });
  assert.notEqual(
    computeDriverHash(),
    changedTreeDriverHash,
    "a driver contract change must invalidate the driver input identity",
  );

  if (process.platform !== "win32") {
    // A model may correctly leave the candidate untouched while returning a
    // malformed final message. The trusted author wrapper must replace that
    // prose with a canonical summary and complete a cacheable safe retry.
    const noDiffRepo = path.join(temp, "no-diff-repo");
    const noDiffState = path.join(temp, "no-diff-state");
    const noDiffHome = path.join(temp, "no-diff-home");
    const fakeBin = path.join(temp, "fake-bin");
    fs.mkdirSync(path.join(noDiffRepo, "codex"), { recursive: true });
    fs.mkdirSync(noDiffState);
    fs.mkdirSync(noDiffHome);
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(path.join(noDiffRepo, "codex", "VERSION"), "version = 1.0.0\n");
    childProcess.execFileSync("git", ["init", "-q"], { cwd: noDiffRepo });
    childProcess.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: noDiffRepo });
    childProcess.execFileSync("git", ["config", "user.name", "Pipeline Test"], { cwd: noDiffRepo });
    childProcess.execFileSync("git", ["add", "--", "codex/VERSION"], { cwd: noDiffRepo });
    childProcess.execFileSync("git", ["commit", "-qm", "baseline"], { cwd: noDiffRepo });

    const noDiffPlanPath = path.join(noDiffState, "ready.json");
    const noDiffSummaryPath = path.join(noDiffState, "summary.md");
    const noDiffReviewPath = path.join(noDiffState, "review.json");
    fs.writeFileSync(noDiffPlanPath, JSON.stringify([{
      tool: "codex",
      dir: "codex",
      old_version: "1.0.0",
      new_version: "1.0.1",
    }]));
    const fakeCodex = path.join(fakeBin, "codex");
    fs.writeFileSync(fakeCodex, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf 'malformed model summary\\n' >\"$CODEX_SUMMARY_FILE\"",
      "",
    ].join("\n"));
    fs.chmodSync(fakeCodex, 0o755);

    const noDiffRun = childProcess.spawnSync(
      "bash",
      [path.join(scripts, "run-codex-refresh.sh")],
      {
        cwd: noDiffRepo,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
          HOME: noDiffHome,
          REPO_ROOT: noDiffRepo,
          TRUSTED_SCRIPT_DIR: scripts,
          CAPTURE_SCRATCH_DIR: noDiffState,
          CODEX_STATE_DIR: noDiffState,
          CODEX_WORK_DIR: path.join(noDiffState, "work"),
          CHANGED_TOOLS_FILE: noDiffPlanPath,
          CODEX_SUMMARY_FILE: noDiffSummaryPath,
          CODEX_VALIDATION_FILE: path.join(noDiffState, "validation.txt"),
          CODEX_REVIEW_FILE: noDiffReviewPath,
          CODEX_DRIVER_PHASE: "author",
          CODEX_DRIVER_ATTEMPT: "1",
        },
      },
    );
    assert.equal(noDiffRun.status, 0, noDiffRun.stderr);
    const trustedSummary = fs.readFileSync(noDiffSummaryPath, "utf8");
    assert.match(trustedSummary, /^## codex\n\nNo tracked update was produced/m);
    assert.doesNotMatch(trustedSummary, /malformed model summary/);
    assert.equal(JSON.parse(fs.readFileSync(noDiffReviewPath, "utf8")).decision, "retry_capture");

    // Reconciliation takes one release-ledger snapshot, creates only missing
    // reachable annotated automation tags, and creates nothing if that query
    // fails.
    const releaseRemote = path.join(temp, "release-remote.git");
    const releaseRepo = path.join(temp, "release-repo");
    const ghLog = path.join(temp, "fake-gh.log");
    childProcess.execFileSync("git", ["init", "--bare", "-q", releaseRemote]);
    fs.mkdirSync(releaseRepo);
    childProcess.execFileSync("git", ["init", "-q"], { cwd: releaseRepo });
    childProcess.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: releaseRepo });
    childProcess.execFileSync("git", ["config", "user.name", "Pipeline Test"], { cwd: releaseRepo });
    fs.writeFileSync(path.join(releaseRepo, "README.md"), "release test\n");
    childProcess.execFileSync("git", ["add", "--", "README.md"], { cwd: releaseRepo });
    childProcess.execFileSync("git", ["commit", "-qm", "baseline"], { cwd: releaseRepo });
    childProcess.execFileSync("git", ["branch", "-M", "main"], { cwd: releaseRepo });
    childProcess.execFileSync("git", ["remote", "add", "origin", releaseRemote], { cwd: releaseRepo });
    childProcess.execFileSync("git", ["tag", "-a", "2026.08.01", "-m", "Automated capture refresh 2026.08.01", "-m", "Existing release."], { cwd: releaseRepo });
    childProcess.execFileSync("git", ["tag", "-a", "2026.08.02-2", "-m", "Automated capture refresh 2026.08.02", "-m", "Missing release."], { cwd: releaseRepo });
    childProcess.execFileSync("git", ["tag", "-a", "2026.08.03", "-m", "Unrelated dated tag"], { cwd: releaseRepo });
    childProcess.execFileSync("git", ["tag", "2026.08.04"], { cwd: releaseRepo });
    childProcess.execFileSync("git", ["push", "-qu", "origin", "main", "--tags"], { cwd: releaseRepo });

    const fakeGh = path.join(fakeBin, "gh");
    fs.writeFileSync(fakeGh, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "case \"${1:-}\" in",
      "  api)",
      "    printf 'API\\n' >>\"$GH_TEST_LOG\"",
      "    [ \"${GH_TEST_FAIL_API:-0}\" != 1 ] || exit 7",
      "    printf '2026.08.01\\n'",
      "    ;;",
      "  release)",
      "    [ \"${2:-}\" = create ] || exit 8",
      "    printf 'CREATE:%s\\n' \"${3:-}\" >>\"$GH_TEST_LOG\"",
      "    ;;",
      "  *) exit 9 ;;",
      "esac",
      "",
    ].join("\n"));
    fs.chmodSync(fakeGh, 0o755);
    fs.writeFileSync(ghLog, "");
    const reconcileEnv = {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      REPO_ROOT: releaseRepo,
      DEFAULT_BRANCH: "main",
      GITHUB_REPOSITORY: "example/repository",
      GH_TEST_LOG: ghLog,
    };
    const reconciled = childProcess.spawnSync(
      "bash",
      [path.join(scripts, "reconcile-release.sh")],
      { cwd: releaseRepo, encoding: "utf8", env: reconcileEnv },
    );
    assert.equal(reconciled.status, 0, reconciled.stderr);
    assert.deepEqual(
      fs.readFileSync(ghLog, "utf8").trim().split("\n"),
      ["API", "CREATE:2026.08.02-2"],
    );

    fs.writeFileSync(ghLog, "");
    const failedLedger = childProcess.spawnSync(
      "bash",
      [path.join(scripts, "reconcile-release.sh")],
      {
        cwd: releaseRepo,
        encoding: "utf8",
        env: { ...reconcileEnv, GH_TEST_FAIL_API: "1" },
      },
    );
    assert.notEqual(failedLedger.status, 0, "release-ledger query failure must fail closed");
    assert.deepEqual(fs.readFileSync(ghLog, "utf8").trim().split("\n"), ["API"]);
  }

  console.log("pipeline result regression tests passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
