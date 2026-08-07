#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const script = path.join(__dirname, "release-ledger.cjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-autopsy-release-ledger-"));
let sequence = 0;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPlan(plan) {
  return crypto.createHash("sha256").update(`${canonicalJson(plan)}\n`).digest("hex");
}

function withHash(plan) {
  return { ...plan, plan_hash: hashPlan(plan) };
}

function makePlan(tool, oldVersion, newVersion, options = {}) {
  const contract = options.contract || "1".repeat(64);
  const common = {
    tool,
    dir: tool,
    old_version: oldVersion,
    new_version: newVersion,
    version_field: tool === "codex" ? "codex_cli_package_version" : "version",
  };
  switch (tool) {
    case "codex":
      return withHash({
        ...common,
        old_revision: options.oldRevision || "a".repeat(40),
        new_revision: options.newRevision || "b".repeat(40),
        capture_contract_hash: contract,
      });
    case "claude-code":
      return withHash({
        ...common,
        artifact_url: `https://downloads.claude.ai/claude-code-releases/${newVersion}/linux-x64/claude`,
        artifact_sha256: options.sha256 || "c".repeat(64),
        capture_contract_hash: contract,
      });
    case "grok":
      return withHash({
        ...common,
        old_revision: options.oldRevision || "a".repeat(40),
        new_revision: options.newRevision || "b".repeat(40),
        mirror_revision: options.mirrorRevision || "c".repeat(40),
        artifact_url: `https://x.ai/cli/grok-${newVersion}-linux-x86_64`,
        artifact_sha256: options.sha256 || "d".repeat(64),
        capture_contract_hash: contract,
      });
    case "antigravity":
      return withHash({
        ...common,
        artifact_url: `https://storage.googleapis.com/antigravity-public/antigravity-cli/${newVersion}-${options.build || "123456"}/linux-x64/cli_linux_x64.tar.gz`,
        artifact_sha512: options.sha512 || "e".repeat(128),
        capture_contract_hash: contract,
      });
    default:
      throw new Error(`unsupported test tool: ${tool}`);
  }
}

function makeState() {
  return {
    codex: {
      version: "1.0.0",
      revision: "a".repeat(40),
      capture_contract_hash: "1".repeat(64),
    },
    "claude-code": {
      version: "2.0.0",
      capture_contract_hash: "2".repeat(64),
    },
    grok: {
      version: "3.0.0",
      revision: "b".repeat(40),
      capture_contract_hash: "3".repeat(64),
    },
    antigravity: {
      version: "4.0.0",
      capture_contract_hash: "4".repeat(64),
    },
  };
}

function execute(ledger, fresh, state, options = {}) {
  sequence += 1;
  const prefix = path.join(temp, `case-${sequence}`);
  const freshPath = `${prefix}-fresh.json`;
  const statePath = `${prefix}-state.json`;
  const ledgerOut = `${prefix}-ledger-out.json`;
  const headOut = `${prefix}-head-out.json`;
  fs.writeFileSync(freshPath, JSON.stringify(fresh));
  fs.writeFileSync(statePath, JSON.stringify(state));
  let ledgerIn = "-";
  if (options.missingLedger) {
    ledgerIn = `${prefix}-does-not-exist.json`;
  } else if (options.rawLedger !== undefined) {
    ledgerIn = `${prefix}-ledger-in.json`;
    fs.writeFileSync(ledgerIn, options.rawLedger);
  } else if (ledger !== null) {
    ledgerIn = `${prefix}-ledger-in.json`;
    fs.writeFileSync(ledgerIn, JSON.stringify(ledger));
  }
  const result = childProcess.spawnSync(
    process.execPath,
    [script, ledgerIn, freshPath, statePath, ledgerOut, headOut],
    { encoding: "utf8" },
  );
  return {
    result,
    ledger: result.status === 0 ? JSON.parse(fs.readFileSync(ledgerOut, "utf8")) : null,
    head: result.status === 0 ? JSON.parse(fs.readFileSync(headOut, "utf8")) : null,
  };
}

try {
  const state = makeState();
  const codex1 = makePlan("codex", "1.0.0", "1.0.1", { newRevision: "b".repeat(40) });
  const codex2 = makePlan("codex", "1.0.0", "1.0.2", { newRevision: "c".repeat(40) });
  const codex3 = makePlan("codex", "1.0.0", "1.0.3", { newRevision: "d".repeat(40) });

  // Each newly observed target is appended without replacing an older pending
  // target, and the persisted representation contains target metadata only.
  const first = execute(null, [codex1], state);
  assert.equal(first.result.status, 0, first.result.stderr);
  const second = execute(first.ledger, [codex2], state);
  assert.equal(second.result.status, 0, second.result.stderr);
  const third = execute(second.ledger, [codex3], state);
  assert.equal(third.result.status, 0, third.result.stderr);
  assert.deepEqual(third.ledger.queues.codex.map((entry) => entry.new_version), ["1.0.1", "1.0.2", "1.0.3"]);
  assert.deepEqual(Object.keys(third.ledger.queues.codex[0]).sort(), ["new_revision", "new_version", "tool"]);
  assert.deepEqual(Object.keys(third.ledger.queues), ["codex", "claude-code", "grok", "antigravity"]);

  // Publishing N drops it and rebases N+1 to the new repository version,
  // revision, and capture contract without mutating the queued target.
  const publishedState = makeState();
  publishedState.codex = {
    version: "1.0.1",
    revision: "b".repeat(40),
    capture_contract_hash: "9".repeat(64),
  };
  const rebased = execute(third.ledger, [], publishedState);
  assert.equal(rebased.result.status, 0, rebased.result.stderr);
  assert.deepEqual(rebased.ledger.queues.codex.map((entry) => entry.new_version), ["1.0.2", "1.0.3"]);
  assert.deepEqual(rebased.head[0], {
    tool: "codex",
    dir: "codex",
    old_version: "1.0.1",
    new_version: "1.0.2",
    version_field: "codex_cli_package_version",
    old_revision: "b".repeat(40),
    new_revision: "c".repeat(40),
    capture_contract_hash: "9".repeat(64),
    plan_hash: hashPlan({
      tool: "codex",
      dir: "codex",
      old_version: "1.0.1",
      new_version: "1.0.2",
      version_field: "codex_cli_package_version",
      old_revision: "b".repeat(40),
      new_revision: "c".repeat(40),
      capture_contract_hash: "9".repeat(64),
    }),
  });

  // Identical observations deduplicate, including when their old plan context
  // predates the current repository state.
  const deduped = execute(rebased.ledger, [codex2, codex2], publishedState);
  assert.equal(deduped.result.status, 0, deduped.result.stderr);
  assert.deepEqual(deduped.ledger.queues.codex.map((entry) => entry.new_version), ["1.0.2", "1.0.3"]);

  const conflict = makePlan("codex", "1.0.0", "1.0.2", { newRevision: "e".repeat(40) });
  const conflicted = execute(rebased.ledger, [conflict], publishedState);
  assert.notEqual(conflicted.result.status, 0);
  assert.match(conflicted.result.stderr, /conflicting metadata for codex 1\.0\.2/);

  // A legacy top-level plan array migrates to the versioned ledger schema.
  const claude = makePlan("claude-code", "2.0.0", "2.0.1", { contract: "2".repeat(64) });
  const antigravity = makePlan("antigravity", "4.0.0", "4.0.1", { contract: "4".repeat(64) });
  const legacy = execute([antigravity, claude], [], state);
  assert.equal(legacy.result.status, 0, legacy.result.stderr);
  assert.equal(legacy.ledger.schema_version, 1);
  assert.deepEqual(legacy.ledger.queues["claude-code"], [{
    tool: "claude-code",
    new_version: "2.0.1",
    artifact_url: "https://downloads.claude.ai/claude-code-releases/2.0.1/linux-x64/claude",
    artifact_sha256: "c".repeat(64),
  }]);
  assert.deepEqual(legacy.head.map((entry) => entry.tool), ["claude-code", "antigravity"]);

  const grok = makePlan("grok", "3.0.0", "3.0.1", {
    oldRevision: "b".repeat(40),
    newRevision: "c".repeat(40),
    mirrorRevision: "d".repeat(40),
    sha256: "e".repeat(64),
    contract: "3".repeat(64),
  });
  const everyTool = execute(null, [antigravity, grok, claude, codex1], state);
  assert.equal(everyTool.result.status, 0, everyTool.result.stderr);
  assert.deepEqual(everyTool.head.map((entry) => entry.tool), [
    "codex", "claude-code", "grok", "antigravity",
  ]);
  assert.deepEqual(everyTool.head[2], {
    tool: "grok",
    dir: "grok",
    old_version: "3.0.0",
    new_version: "3.0.1",
    version_field: "version",
    old_revision: "b".repeat(40),
    new_revision: "c".repeat(40),
    mirror_revision: "d".repeat(40),
    artifact_url: "https://x.ai/cli/grok-3.0.1-linux-x86_64",
    artifact_sha256: "e".repeat(64),
    capture_contract_hash: "3".repeat(64),
    plan_hash: hashPlan(Object.fromEntries(
      Object.entries(everyTool.head[2]).filter(([key]) => key !== "plan_hash"),
    )),
  });
  assert.equal(everyTool.head[3].artifact_sha512, "e".repeat(128));
  assert.equal(everyTool.head[3].capture_contract_hash, "4".repeat(64));

  // A nonexistent ledger is equivalent to `-`.
  const missing = execute(null, [claude], state, { missingLedger: true });
  assert.equal(missing.result.status, 0, missing.result.stderr);
  assert.deepEqual(missing.ledger, execute(null, [claude], state).ledger);

  // A present but truncated durable ledger is corruption, not an empty queue.
  const truncated = execute(null, [], state, { rawLedger: "  \n" });
  assert.notEqual(truncated.result.status, 0);
  assert.match(truncated.result.stderr, /release ledger is not valid JSON/);

  // Stable semver ordering is deterministic rather than lexical.
  const semverOrdered = execute(null, [
    makePlan("codex", "1.0.0", "1.0.10", { newRevision: "e".repeat(40) }),
    makePlan("codex", "1.0.0", "1.0.2", { newRevision: "c".repeat(40) }),
    makePlan("codex", "1.0.0", "1.0.1", { newRevision: "f".repeat(40) }),
  ], state);
  assert.equal(semverOrdered.result.status, 0, semverOrdered.result.stderr);
  assert.deepEqual(semverOrdered.ledger.queues.codex.map((entry) => entry.new_version), [
    "1.0.1", "1.0.2", "1.0.10",
  ]);

  // Repeated reconciliation emits byte-for-byte deterministic plan hashes.
  const deterministicAgain = execute(semverOrdered.ledger, [], state);
  assert.equal(deterministicAgain.result.status, 0, deterministicAgain.result.stderr);
  assert.equal(deterministicAgain.head[0].plan_hash, semverOrdered.head[0].plan_hash);
  // Independently pinned from `jq -cS . | sha256sum`, including jq's newline.
  assert.equal(
    deterministicAgain.head[0].plan_hash,
    "f5b561af360b5e3bb03f431c03429166c556b74543554dc0f6ec1ec37895a606",
  );

  const prerelease = execute(null, [
    makePlan("codex", "1.0.0", "1.0.1-beta.2", { newRevision: "b".repeat(40) }),
  ], state);
  assert.notEqual(prerelease.result.status, 0);
  assert.match(prerelease.result.stderr, /stable numeric x\.y\.z release/);

  // A manual or corrupted VERSION jump may acknowledge exactly the queue head,
  // but may never silently skip over it.
  const jumpedState = makeState();
  jumpedState.codex = {
    version: "1.0.2",
    revision: "c".repeat(40),
    capture_contract_hash: "1".repeat(64),
  };
  const skippedHead = execute(third.ledger, [], jumpedState);
  assert.notEqual(skippedHead.result.status, 0);
  assert.match(skippedHead.result.stderr, /past queued head 1\.0\.1/);

  const malformedState = makeState();
  delete malformedState.grok.revision;
  const rejectedState = execute(null, [], malformedState);
  assert.notEqual(rejectedState.result.status, 0);
  assert.match(rejectedState.result.stderr, /current state for grok must contain exactly/);

  const wrongUrl = makePlan("claude-code", "2.0.0", "2.0.1", { contract: "2".repeat(64) });
  wrongUrl.artifact_url = "https://downloads.claude.ai/claude-code-releases/9.9.9/linux-x64/claude";
  wrongUrl.plan_hash = hashPlan(Object.fromEntries(Object.entries(wrongUrl).filter(([key]) => key !== "plan_hash")));
  const rejectedUrl = execute(null, [wrongUrl], state);
  assert.notEqual(rejectedUrl.result.status, 0);
  assert.match(rejectedUrl.result.stderr, /artifact_url does not match/);

  const wrongDigest = { ...claude, artifact_sha256: "C".repeat(64) };
  wrongDigest.plan_hash = hashPlan(Object.fromEntries(
    Object.entries(wrongDigest).filter(([key]) => key !== "plan_hash"),
  ));
  const rejectedDigest = execute(null, [wrongDigest], state);
  assert.notEqual(rejectedDigest.result.status, 0);
  assert.match(rejectedDigest.result.stderr, /lowercase SHA-256 digest/);

  const unexpectedMetadata = { ...codex1, injected: true };
  const rejectedMetadata = execute(null, [unexpectedMetadata], state);
  assert.notEqual(rejectedMetadata.result.status, 0);
  assert.match(rejectedMetadata.result.stderr, /must contain exactly/);

  const badLegacyHash = { ...claude, plan_hash: "0".repeat(64) };
  const rejectedLegacy = execute([badLegacyHash], [], state);
  assert.notEqual(rejectedLegacy.result.status, 0);
  assert.match(rejectedLegacy.result.stderr, /plan_hash does not match/);

  console.log("release ledger regression tests passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
