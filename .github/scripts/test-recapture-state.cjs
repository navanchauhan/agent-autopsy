#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const scripts = __dirname;
const captureMetadataWriter = path.join(scripts, "write-capture-artifact-metadata.cjs");
const driverMetadataWriter = path.join(scripts, "write-driver-artifact-metadata.cjs");
const recaptureSelector = path.join(scripts, "select-recapture-state.cjs");
const stateFinalizer = path.join(scripts, "update-recapture-state.cjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-autopsy-recapture-state-"));
let sequence = 0;

function run(script, args) {
  return childProcess.spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
  });
}

function pass(script, args) {
  const result = run(script, args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeCase(name) {
  sequence += 1;
  const directory = path.join(temp, `${String(sequence).padStart(2, "0")}-${name}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function makePlan(tool = "codex", digit = "1") {
  return {
    tool,
    dir: tool,
    old_version: "1.0.0",
    new_version: "2.0.0",
    capture_contract_hash: digit.repeat(64),
    plan_hash: String((Number(digit) + 4) % 10).repeat(64),
  };
}

function entry(planHash, overrides = {}) {
  return {
    plan_hash: planHash,
    state: "clear",
    request_after_run_id: null,
    request_after_run_attempt: null,
    last_fresh_bucket: null,
    last_reviewer_input_hash: null,
    reason: null,
    ...overrides,
  };
}

function state(tools = {}) {
  return { schema_version: 1, tools };
}

function captureArtifact(root, plan, options = {}) {
  const attempt = options.attempt ?? 1;
  const runId = options.runId ?? "100";
  const bucket = options.bucket ?? "20260806";
  const source = options.source ?? "fresh";
  const forced = options.forced ?? false;
  const degraded = options.degraded ?? false;
  const status = options.status ?? "captured";
  const directory = path.join(root, `capture-bundle-${plan.tool}-attempt-${attempt}`);
  fs.mkdirSync(path.join(directory, "evidence"), { recursive: true });
  writeJson(path.join(directory, "result.json"), {
    tool: plan.tool,
    target_version: plan.new_version,
    status,
    message: options.message ?? status,
    capture_contract_hash: plan.capture_contract_hash,
    plan_hash: plan.plan_hash,
  });
  fs.writeFileSync(
    path.join(directory, "evidence", "capture.txt"),
    options.payload ?? `${plan.tool}:${attempt}:${status}\n`,
  );
  pass(captureMetadataWriter, [
    directory,
    plan.tool,
    plan.plan_hash,
    runId,
    String(attempt),
    source,
    String(forced),
    String(degraded),
    bucket,
  ]);
  return directory;
}

function driverArtifact(root, options = {}) {
  const attempt = options.attempt ?? 1;
  const runId = options.runId ?? "100";
  const bucket = options.bucket ?? "20260806";
  const source = options.source ?? "fresh";
  const approved = options.approved ?? [];
  const retries = options.retries ?? [];
  const captureRetries = options.captureRetries ?? [];
  const inputHash = options.inputHash ?? "a".repeat(64);
  const reviewInputHash = options.reviewInputHash ?? inputHash;
  const reviewInputHashes = options.reviewInputHashes ?? {};
  const directory = path.join(root, `driver-output-attempt-${attempt}`);
  fs.mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, "result.json"), {
    has_publishable: approved.length > 0,
    ...(source === "capture_only" ? {} : { base_sha: "b".repeat(40) }),
    approved_tools: approved,
    retry_tools: [...retries, ...captureRetries],
  });
  writeJson(
    path.join(directory, "capture-retries.json"),
    captureRetries.map((tool) => ({
      ...makePlan(tool, tool === "codex" ? "1" : "2"),
      status: "source_sync_error",
      message: "source unavailable",
    })),
  );
  if (source !== "capture_only") {
    writeJson(
      path.join(directory, "retry-report.json"),
      retries.map((tool) => ({
        tool,
        outcome: "retry_capture",
        review_input_hash: reviewInputHashes[tool] ?? reviewInputHash,
        issues: ["more evidence required"],
      })),
    );
    fs.writeFileSync(path.join(directory, "base-sha.txt"), `${"b".repeat(40)}\n`);
    fs.writeFileSync(path.join(directory, "candidate.patch"), approved.length > 0 ? "reviewed patch\n" : "");
    writeJson(path.join(directory, "changed-tools.json"), approved);
    fs.writeFileSync(path.join(directory, "codex-summary.md"), "## codex\nreviewed\n");
    writeJson(path.join(directory, "review-result.json"), { decision: approved.length ? "approve" : "retry_capture" });
  }
  pass(driverMetadataWriter, [
    directory,
    source === "capture_only" ? "none" : inputHash,
    runId,
    String(attempt),
    bucket,
    source,
  ]);
  return directory;
}

function finalize(caseDirectory, plan, prior, options = {}) {
  sequence += 1;
  const invocation = path.join(caseDirectory, `finalize-${sequence}`);
  const planPath = path.join(invocation, "plan.json");
  const priorPath = path.join(invocation, "prior.json");
  const outputPath = path.join(invocation, "output.json");
  const captureRoot = options.captureRoot ?? path.join(caseDirectory, "capture-downloads");
  const driverRoot = options.driverRoot ?? path.join(caseDirectory, "driver-downloads");
  fs.mkdirSync(captureRoot, { recursive: true });
  fs.mkdirSync(driverRoot, { recursive: true });
  writeJson(planPath, plan);
  writeJson(priorPath, prior);
  const result = run(stateFinalizer, [
    priorPath,
    planPath,
    captureRoot,
    driverRoot,
    options.runId ?? "100",
    String(options.attempt ?? 1),
    options.bucket ?? "20260806",
    outputPath,
  ]);
  return {
    result,
    outputPath,
    output: result.status === 0 ? JSON.parse(fs.readFileSync(outputPath, "utf8")) : null,
  };
}

function finalized(caseDirectory, plan, prior, options = {}) {
  const result = finalize(caseDirectory, plan, prior, options);
  assert.equal(result.result.status, 0, result.result.stderr || result.result.stdout);
  for (const planEntry of plan) {
    pass(recaptureSelector, [
      result.outputPath,
      planEntry.tool,
      planEntry.plan_hash,
      options.bucket ?? "20260806",
    ]);
  }
  return result;
}

try {
  // Driver metadata is exact, recursive, deterministic, and source-aware.
  {
    const testCase = makeCase("driver-metadata");
    const driver = path.join(testCase, "driver");
    fs.mkdirSync(path.join(driver, "nested"), { recursive: true });
    fs.writeFileSync(path.join(driver, "z.txt"), "zeta\n");
    fs.writeFileSync(path.join(driver, "nested", "a.txt"), "alpha\n");
    pass(driverMetadataWriter, [driver, "a".repeat(64), "100", "2", "20260806", "fresh"]);
    const firstBytes = fs.readFileSync(path.join(driver, "workflow-run.json"), "utf8");
    const first = JSON.parse(firstBytes);
    assert.deepEqual(Object.keys(first).sort(), [
      "bundle_sha256",
      "capture_bucket",
      "input_hash",
      "run_attempt",
      "run_id",
      "schema_version",
      "source",
    ]);
    assert.deepEqual(first, {
      schema_version: 1,
      input_hash: "a".repeat(64),
      run_id: "100",
      run_attempt: 2,
      capture_bucket: "20260806",
      source: "fresh",
      bundle_sha256: first.bundle_sha256,
    });
    assert.match(first.bundle_sha256, /^[0-9a-f]{64}$/);

    pass(driverMetadataWriter, [driver, "a".repeat(64), "100", "2", "20260806", "fresh"]);
    assert.equal(fs.readFileSync(path.join(driver, "workflow-run.json"), "utf8"), firstBytes);
    fs.appendFileSync(path.join(driver, "nested", "a.txt"), "changed\n");
    pass(driverMetadataWriter, [driver, "a".repeat(64), "100", "2", "20260806", "fresh"]);
    assert.notEqual(JSON.parse(fs.readFileSync(path.join(driver, "workflow-run.json"))).bundle_sha256, first.bundle_sha256);

    const captureOnly = path.join(testCase, "capture-only");
    fs.mkdirSync(captureOnly);
    writeJson(path.join(captureOnly, "result.json"), {
      has_publishable: false,
      approved_tools: [],
      retry_tools: [],
    });
    pass(driverMetadataWriter, [captureOnly, "none", "100", "3", "20260806", "capture_only"]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(captureOnly, "workflow-run.json"))).input_hash, null);
    const invalidCaptureOnly = run(driverMetadataWriter, [
      captureOnly,
      "a".repeat(64),
      "100",
      "3",
      "20260806",
      "capture_only",
    ]);
    assert.notEqual(invalidCaptureOnly.status, 0);
    assert.match(invalidCaptureOnly.stderr, /requires input hash 'none'/);

    const symlinkDriver = path.join(testCase, "symlink-driver");
    fs.mkdirSync(symlinkDriver);
    fs.writeFileSync(path.join(symlinkDriver, "target.txt"), "target\n");
    let madeSymlink = false;
    try {
      fs.symlinkSync(path.join(symlinkDriver, "target.txt"), path.join(symlinkDriver, "link.txt"), "file");
      madeSymlink = true;
    } catch (error) {
      if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
    }
    if (madeSymlink) {
      const rejected = run(driverMetadataWriter, [
        symlinkDriver,
        "a".repeat(64),
        "100",
        "1",
        "20260806",
        "fresh",
      ]);
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /symbolic link/);
    }
  }

  // Plan changes reset state and tools no longer present in the plan are pruned.
  {
    const testCase = makeCase("plan-reset");
    const codex = makePlan("codex", "1");
    const grok = makePlan("grok", "2");
    const result = finalized(testCase, [codex], state({
      codex: entry("f".repeat(64), {
        state: "force_once",
        request_after_run_id: "99",
        request_after_run_attempt: 7,
        last_fresh_bucket: "20260805",
        last_reviewer_input_hash: "e".repeat(64),
        reason: "reviewer",
      }),
      grok: entry(grok.plan_hash),
    }));
    assert.deepEqual(result.output, state({ codex: entry(codex.plan_hash) }));
  }

  // A security-degraded capture arms a later attempt; only a later fresh
  // capture consumes it, and replaying the artifact history is idempotent.
  {
    const testCase = makeCase("security-cross-attempt");
    const plan = makePlan("codex", "1");
    const captures = path.join(testCase, "capture-downloads");
    captureArtifact(captures, plan, { status: "retry_capture", degraded: true, attempt: 1 });
    const first = finalized(testCase, [plan], state({ codex: entry(plan.plan_hash) }), {
      captureRoot: captures,
      attempt: 1,
    });
    assert.deepEqual(first.output.tools.codex, entry(plan.plan_hash, {
      state: "force_once",
      request_after_run_id: "100",
      request_after_run_attempt: 1,
      last_fresh_bucket: "20260806",
      reason: "security",
    }));
    const firstReplay = finalized(testCase, [plan], first.output, {
      captureRoot: captures,
      attempt: 1,
    });
    assert.deepEqual(firstReplay.output, first.output);

    captureArtifact(captures, plan, { status: "captured", attempt: 2 });
    const second = finalized(testCase, [plan], first.output, {
      captureRoot: captures,
      attempt: 2,
    });
    assert.deepEqual(second.output.tools.codex, entry(plan.plan_hash, {
      last_fresh_bucket: "20260806",
    }));
    const fullReplay = finalized(testCase, [plan], second.output, {
      captureRoot: captures,
      attempt: 2,
    });
    assert.deepEqual(fullReplay.output, second.output);
  }

  // A fresh retry selected by force_once that is still security-degraded has
  // spent the one-shot request, so it suppresses further positive-cache
  // polling instead of re-arming itself on every scheduled run.
  {
    const testCase = makeCase("forced-security-suppression");
    const plan = makePlan("codex", "1");
    const captures = path.join(testCase, "capture-downloads");
    captureArtifact(captures, plan, {
      status: "retry_capture",
      degraded: true,
      attempt: 1,
    });
    const prior = state({
      codex: entry(plan.plan_hash, {
        state: "force_once",
        request_after_run_id: "99",
        request_after_run_attempt: 9,
        reason: "security",
      }),
    });
    const result = finalized(testCase, [plan], prior, { captureRoot: captures });
    assert.deepEqual(result.output.tools.codex, entry(plan.plan_hash, {
      state: "suppress_positive",
      last_fresh_bucket: "20260806",
      reason: "security",
    }));
    assert.deepEqual(
      finalized(testCase, [plan], result.output, { captureRoot: captures }).output,
      result.output,
    );
  }

  // A first trusted fresh retry immediately enters bounded suppression, even
  // without a pre-existing force request, and records the fresh bucket.
  {
    const testCase = makeCase("initial-fresh-retry");
    const plan = makePlan("codex", "1");
    const captures = path.join(testCase, "capture-downloads");
    captureArtifact(captures, plan, { status: "retry_capture" });
    const result = finalized(testCase, [plan], state({ codex: entry(plan.plan_hash) }), {
      captureRoot: captures,
    });
    assert.deepEqual(result.output.tools.codex, entry(plan.plan_hash, {
      state: "suppress_positive",
      last_fresh_bucket: "20260806",
      reason: "capture_retry",
    }));
    assert.deepEqual(
      finalized(testCase, [plan], result.output, { captureRoot: captures }).output,
      result.output,
    );
  }

  // A trusted retry-cache artifact also suppresses positive-cache polling, but
  // it must not claim that a fresh capture ran in the current bucket.
  {
    const testCase = makeCase("retry-cache-suppression");
    const plan = makePlan("codex", "1");
    const captures = path.join(testCase, "capture-downloads");
    captureArtifact(captures, plan, { status: "retry_capture", source: "retry_cache" });
    const result = finalized(testCase, [plan], state({
      codex: entry(plan.plan_hash, { last_fresh_bucket: "20260805" }),
    }), { captureRoot: captures });
    assert.deepEqual(result.output.tools.codex, entry(plan.plan_hash, {
      state: "suppress_positive",
      last_fresh_bucket: "20260805",
      reason: "capture_retry",
    }));
  }

  // A later fresh retry consumes force_once exactly once and suppresses the
  // positive cache instead of requesting an unbounded retry loop.
  {
    const testCase = makeCase("force-retry-suppression");
    const plan = makePlan("codex", "1");
    const captures = path.join(testCase, "capture-downloads");
    captureArtifact(captures, plan, { status: "retry_capture" });
    const prior = state({
      codex: entry(plan.plan_hash, {
        state: "force_once",
        request_after_run_id: "99",
        request_after_run_attempt: 9,
        reason: "reviewer",
      }),
    });
    const result = finalized(testCase, [plan], prior, { captureRoot: captures });
    assert.deepEqual(result.output.tools.codex, entry(plan.plan_hash, {
      state: "suppress_positive",
      last_fresh_bucket: "20260806",
      reason: "capture_retry",
    }));
    assert.deepEqual(
      finalized(testCase, [plan], result.output, { captureRoot: captures }).output,
      result.output,
    );
  }

  // Manual fresh retries suppress cached positives; a later manual success
  // clears the suppression while preserving the fresh-capture history.
  {
    const testCase = makeCase("manual-force");
    const plan = makePlan("codex", "1");
    const captures = path.join(testCase, "capture-downloads");
    captureArtifact(captures, plan, { status: "retry_capture", forced: true, attempt: 1 });
    const first = finalized(testCase, [plan], state({ codex: entry(plan.plan_hash) }), {
      captureRoot: captures,
      attempt: 1,
    });
    assert.deepEqual(first.output.tools.codex, entry(plan.plan_hash, {
      state: "suppress_positive",
      last_fresh_bucket: "20260806",
      reason: "capture_retry",
    }));
    captureArtifact(captures, plan, { status: "captured", forced: true, attempt: 2 });
    const second = finalized(testCase, [plan], first.output, {
      captureRoot: captures,
      attempt: 2,
    });
    assert.deepEqual(second.output.tools.codex, entry(plan.plan_hash, {
      last_fresh_bucket: "20260806",
    }));
  }

  // A reviewer retry after a fresh capture in the same bucket early-stops.
  // Identical reviewer inputs never re-arm; a new next-day input does.
  {
    const testCase = makeCase("reviewer-early-stop");
    const plan = makePlan("codex", "1");
    const captures = path.join(testCase, "capture-downloads");
    const drivers = path.join(testCase, "driver-downloads");
    const firstHash = "a".repeat(64);
    const secondHash = "c".repeat(64);
    captureArtifact(captures, plan, { status: "captured", attempt: 1 });
    driverArtifact(drivers, { retries: ["codex"], inputHash: firstHash, attempt: 1 });
    const first = finalized(testCase, [plan], state({ codex: entry(plan.plan_hash) }), {
      captureRoot: captures,
      driverRoot: drivers,
      attempt: 1,
    });
    assert.deepEqual(first.output.tools.codex, entry(plan.plan_hash, {
      state: "suppress_positive",
      last_fresh_bucket: "20260806",
      last_reviewer_input_hash: firstHash,
      reason: "reviewer",
    }));
    const replay = finalized(testCase, [plan], first.output, {
      captureRoot: captures,
      driverRoot: drivers,
      attempt: 1,
    });
    assert.deepEqual(replay.output, first.output);
    assert.equal(
      fs.readFileSync(replay.outputPath, "utf8"),
      fs.readFileSync(first.outputPath, "utf8"),
      "full artifact replay must be byte-for-byte deterministic",
    );

    driverArtifact(drivers, { retries: ["codex"], inputHash: firstHash, attempt: 2 });
    const sameHash = finalized(testCase, [plan], replay.output, {
      captureRoot: captures,
      driverRoot: drivers,
      attempt: 2,
    });
    assert.deepEqual(sameHash.output, replay.output);

    driverArtifact(drivers, {
      retries: ["codex"],
      inputHash: secondHash,
      attempt: 3,
      bucket: "20260807",
    });
    const nextDay = finalized(testCase, [plan], sameHash.output, {
      captureRoot: captures,
      driverRoot: drivers,
      attempt: 3,
      bucket: "20260807",
    });
    assert.deepEqual(nextDay.output.tools.codex, entry(plan.plan_hash, {
      state: "force_once",
      request_after_run_id: "100",
      request_after_run_attempt: 3,
      last_fresh_bucket: "20260806",
      last_reviewer_input_hash: secondHash,
      reason: "reviewer",
    }));
    assert.deepEqual(
      finalized(testCase, [plan], nextDay.output, {
        captureRoot: captures,
        driverRoot: drivers,
        attempt: 3,
        bucket: "20260807",
      }).output,
      nextDay.output,
    );
  }

  // Without a fresh capture in the bucket, a new reviewer retry is armed only
  // after the driver event so an earlier capture in that attempt cannot spend it.
  {
    const testCase = makeCase("reviewer-force");
    const plan = makePlan("codex", "1");
    const drivers = path.join(testCase, "driver-downloads");
    driverArtifact(drivers, {
      retries: ["codex"],
      inputHash: "9".repeat(64),
      reviewInputHash: "d".repeat(64),
      attempt: 1,
    });
    const result = finalized(testCase, [plan], state({ codex: entry(plan.plan_hash) }), {
      driverRoot: drivers,
    });
    assert.deepEqual(result.output.tools.codex, entry(plan.plan_hash, {
      state: "force_once",
      request_after_run_id: "100",
      request_after_run_attempt: 1,
      last_reviewer_input_hash: "d".repeat(64),
      reason: "reviewer",
    }));
  }

  // Reviewer dedupe is per tool: changing the aggregate driver input because
  // one tool changed must not spend tokens re-arming an unchanged peer.
  {
    const testCase = makeCase("per-tool-review-dedupe");
    const codex = makePlan("codex", "1");
    const grok = makePlan("grok", "2");
    const drivers = path.join(testCase, "driver-downloads");
    driverArtifact(drivers, {
      retries: ["codex", "grok"],
      inputHash: "8".repeat(64),
      reviewInputHashes: {
        codex: "a".repeat(64),
        grok: "b".repeat(64),
      },
      attempt: 1,
    });
    const first = finalized(testCase, [codex, grok], state({
      codex: entry(codex.plan_hash),
      grok: entry(grok.plan_hash),
    }), { driverRoot: drivers });
    assert.equal(first.output.tools.codex.request_after_run_attempt, 1);
    assert.equal(first.output.tools.grok.request_after_run_attempt, 1);

    driverArtifact(drivers, {
      retries: ["codex", "grok"],
      inputHash: "9".repeat(64),
      reviewInputHashes: {
        codex: "a".repeat(64),
        grok: "c".repeat(64),
      },
      attempt: 2,
    });
    const second = finalized(testCase, [codex, grok], first.output, {
      driverRoot: drivers,
      attempt: 2,
    });
    assert.equal(second.output.tools.codex.request_after_run_attempt, 1);
    assert.equal(second.output.tools.codex.last_reviewer_input_hash, "a".repeat(64));
    assert.equal(second.output.tools.grok.request_after_run_attempt, 2);
    assert.equal(second.output.tools.grok.last_reviewer_input_hash, "c".repeat(64));
  }

  // The trusted per-tool review hash is mandatory; a correctly signed legacy
  // retry report without it is still rejected by the state finalizer.
  {
    const testCase = makeCase("missing-review-hash");
    const plan = makePlan("codex", "1");
    const drivers = path.join(testCase, "driver-downloads");
    const driver = driverArtifact(drivers, { retries: ["codex"] });
    const reportPath = path.join(driver, "retry-report.json");
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    delete report[0].review_input_hash;
    writeJson(reportPath, report);
    pass(driverMetadataWriter, [driver, "a".repeat(64), "100", "1", "20260806", "fresh"]);
    const rejected = finalize(testCase, [plan], state({ codex: entry(plan.plan_hash) }), {
      driverRoot: drivers,
    });
    assert.notEqual(rejected.result.status, 0);
    assert.match(rejected.result.stderr, /retry report contains an invalid or duplicate entry/);
  }

  // Full driver artifacts partition every planned tool exactly once. A source
  // synchronization retry is recorded for reporting but does not arm another
  // provider capture by itself.
  {
    const testCase = makeCase("mixed-partitions");
    const codex = makePlan("codex", "1");
    const grok = makePlan("grok", "2");
    const drivers = path.join(testCase, "driver-downloads");
    driverArtifact(drivers, { approved: ["codex"], captureRetries: ["grok"] });
    const prior = state({
      codex: entry(codex.plan_hash),
      grok: entry(grok.plan_hash, {
        state: "force_once",
        request_after_run_id: "99",
        request_after_run_attempt: 1,
        reason: "reviewer",
      }),
    });
    const result = finalized(testCase, [codex, grok], prior, { driverRoot: drivers });
    assert.deepEqual(result.output.tools.codex, entry(codex.plan_hash));
    assert.deepEqual(result.output.tools.grok, prior.tools.grok);
  }

  {
    const testCase = makeCase("duplicate-partition");
    const plan = makePlan("codex", "1");
    const drivers = path.join(testCase, "driver-downloads");
    driverArtifact(drivers, { approved: ["codex"], captureRetries: ["codex"] });
    const rejected = finalize(testCase, [plan], state({ codex: entry(plan.plan_hash) }), {
      driverRoot: drivers,
    });
    assert.notEqual(rejected.result.status, 0);
    assert.match(rejected.result.stderr, /more than one decision partition/);
  }

  {
    const testCase = makeCase("missing-partition");
    const plan = makePlan("codex", "1");
    const drivers = path.join(testCase, "driver-downloads");
    driverArtifact(drivers, {});
    const rejected = finalize(testCase, [plan], state({ codex: entry(plan.plan_hash) }), {
      driverRoot: drivers,
    });
    assert.notEqual(rejected.result.status, 0);
    assert.match(rejected.result.stderr, /does not partition every planned tool/);
  }

  // download-artifact flattens a single pattern match into the requested root.
  // The finalizer must accept that layout without weakening metadata or digest
  // validation.
  {
    const testCase = makeCase("flattened-driver-download");
    const plan = makePlan("codex", "1");
    const drivers = path.join(testCase, "driver-downloads");
    const nested = driverArtifact(drivers, { approved: ["codex"] });
    for (const name of fs.readdirSync(nested)) {
      fs.renameSync(path.join(nested, name), path.join(drivers, name));
    }
    fs.rmdirSync(nested);
    const result = finalized(testCase, [plan], state({ codex: entry(plan.plan_hash) }), {
      driverRoot: drivers,
    });
    assert.deepEqual(result.output.tools.codex, entry(plan.plan_hash));
  }

  // Approval clears pending work but retains bounded history needed for future
  // same-bucket and same-input early stopping.
  {
    const testCase = makeCase("approval");
    const plan = makePlan("codex", "1");
    const drivers = path.join(testCase, "driver-downloads");
    driverArtifact(drivers, { approved: ["codex"], inputHash: "e".repeat(64) });
    const prior = state({
      codex: entry(plan.plan_hash, {
        state: "force_once",
        request_after_run_id: "99",
        request_after_run_attempt: 2,
        last_fresh_bucket: "20260805",
        last_reviewer_input_hash: "f".repeat(64),
        reason: "reviewer",
      }),
    });
    const result = finalized(testCase, [plan], prior, { driverRoot: drivers });
    assert.deepEqual(result.output.tools.codex, entry(plan.plan_hash, {
      last_fresh_bucket: "20260805",
      last_reviewer_input_hash: "f".repeat(64),
    }));
  }

  // Every artifact from one attempt is bound to the same bucket, preventing a
  // replay from fabricating an impossible capture-before-driver chronology.
  {
    const testCase = makeCase("conflicting-attempt-buckets");
    const plan = makePlan("codex", "1");
    const captures = path.join(testCase, "capture-downloads");
    const drivers = path.join(testCase, "driver-downloads");
    captureArtifact(captures, plan, { bucket: "20260805", attempt: 1 });
    driverArtifact(drivers, { bucket: "20260806", attempt: 1, captureRetries: ["codex"] });
    const rejected = finalize(testCase, [plan], state({ codex: entry(plan.plan_hash) }), {
      captureRoot: captures,
      driverRoot: drivers,
      attempt: 2,
      bucket: "20260807",
    });
    assert.notEqual(rejected.result.status, 0);
    assert.match(rejected.result.stderr, /conflicting capture buckets/);
  }

  // Artifact metadata is an integrity boundary for both capture and driver
  // downloads; changing a payload after signing must fail closed.
  {
    const plan = makePlan("codex", "1");
    const captureCase = makeCase("capture-tamper");
    const captures = path.join(captureCase, "capture-downloads");
    const capture = captureArtifact(captures, plan);
    fs.appendFileSync(path.join(capture, "evidence", "capture.txt"), "tampered\n");
    const captureFailure = finalize(captureCase, [plan], state({ codex: entry(plan.plan_hash) }), {
      captureRoot: captures,
    });
    assert.notEqual(captureFailure.result.status, 0);
    assert.match(captureFailure.result.stderr, /capture artifact digest is invalid/);

    const driverCase = makeCase("driver-tamper");
    const drivers = path.join(driverCase, "driver-downloads");
    const driver = driverArtifact(drivers, { retries: ["codex"] });
    fs.appendFileSync(path.join(driver, "codex-summary.md"), "tampered\n");
    const driverFailure = finalize(driverCase, [plan], state({ codex: entry(plan.plan_hash) }), {
      driverRoot: drivers,
    });
    assert.notEqual(driverFailure.result.status, 0);
    assert.match(driverFailure.result.stderr, /driver artifact digest is invalid/);
  }

  console.log("recapture state regression tests passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
