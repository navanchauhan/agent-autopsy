#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const scripts = __dirname;
const writer = path.join(scripts, "write-capture-artifact-metadata.cjs");
const selector = path.join(scripts, "select-capture-artifacts.cjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-autopsy-capture-artifacts-"));
const planHash = "a".repeat(64);
const contractHash = "b".repeat(64);
const plan = [{
  tool: "codex",
  dir: "codex",
  old_version: "1.0.0",
  new_version: "1.0.1",
  capture_contract_hash: contractHash,
  plan_hash: planHash,
}];

function run(script, args) {
  return childProcess.spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
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

function state(entry = null) {
  return {
    schema_version: 1,
    tools: entry ? { codex: entry } : {},
  };
}

function stateEntry(overrides = {}) {
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

function artifact(root, attempt, options = {}) {
  const status = options.status ?? "captured";
  const source = options.source ?? "fresh";
  const forced = options.forced ?? false;
  const degraded = options.degraded ?? false;
  const directory = path.join(root, `capture-bundle-codex-attempt-${attempt}`);
  fs.mkdirSync(path.join(directory, "evidence"), { recursive: true });
  writeJson(path.join(directory, "result.json"), {
    tool: "codex",
    target_version: "1.0.1",
    status,
    message: status,
    capture_contract_hash: contractHash,
    plan_hash: planHash,
  });
  fs.writeFileSync(path.join(directory, "evidence", "source.txt"), `attempt ${attempt}\n`);
  pass(writer, [
    directory, "codex", planHash, "100", String(attempt), source,
    String(forced), String(degraded), options.bucket ?? "20260806",
  ]);
  return directory;
}

function select(caseRoot, downloads, durableState, attempt, force = false) {
  const planFile = path.join(caseRoot, "plan.json");
  const stateFile = path.join(caseRoot, "state.json");
  const output = path.join(caseRoot, "selected");
  writeJson(planFile, plan);
  writeJson(stateFile, durableState);
  const result = run(selector, [
    planFile, stateFile, downloads, output, "100", String(attempt), String(force),
  ]);
  return { result, output };
}

let sequence = 0;
function makeCase(label) {
  sequence += 1;
  const root = path.join(temp, `${sequence}-${label}`);
  const downloads = path.join(root, "downloads");
  fs.mkdirSync(downloads, { recursive: true });
  return { root, downloads };
}

try {
  {
    const workflow = fs.readFileSync(
      path.join(scripts, "../workflows/daily-refresh.yml"),
      "utf8",
    );
    const versionCheck = fs.readFileSync(
      path.join(scripts, "check-versions.sh"),
      "utf8",
    );
    assert.doesNotMatch(
      workflow,
      /GROK_REFRESH_ENABLED:\s*["']false["']/,
      "the production workflow must keep Grok enabled",
    );
    assert.match(
      versionCheck,
      /GROK_REFRESH_ENABLED:-true/,
      "Grok refresh must default to enabled when the production workflow omits the override",
    );
    assert.match(
      versionCheck,
      /map\(select\(\.tool != "grok"\)\)/,
      "a disabled Grok provider must be removed before matrix planning",
    );
    assert.match(
      versionCheck,
      /preserved in the durable queue but omitted from the active plan/,
      "disabling Grok must preserve its pending release for later re-enable",
    );
    assert.match(
      workflow,
      /fast_forward_claude:[\s\S]*?type: boolean[\s\S]*?default: false/,
      "Claude fast-forward must be an explicit manual boolean input",
    );
    assert.match(
      workflow,
      /CLAUDE_FAST_FORWARD: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.fast_forward_claude/,
      "scheduled runs must not enable Claude fast-forward",
    );
    assert.match(
      versionCheck,
      /CLAUDE_FAST_FORWARD:-false/,
      "Claude fast-forward must default to disabled",
    );
    assert.match(
      versionCheck,
      /release-ledger\.claude-fast-forward\.json[\s\S]*?\.queues\["claude-code"\] = \[\]/,
      "manual Claude fast-forward must discard only the older Claude queue",
    );
  }

  {
    const antigravityWrapper = fs.readFileSync(
      path.join(scripts, "capture-antigravity.sh"),
      "utf8",
    );
    assert.match(
      antigravityWrapper,
      /--prompt-interactive %q[\s\S]+"Reply exactly: \$interactive_marker"/,
      "Antigravity TUI capture must start through the CLI's initial-prompt interface",
    );
    assert.doesNotMatch(
      antigravityWrapper,
      /tmux send-keys[^\n]+interactive_marker/,
      "Antigravity marker capture must not depend on post-startup terminal keystroke injection",
    );
  }

  {
    const claudeWrapper = fs.readFileSync(
      path.join(scripts, "capture-claude-code.sh"),
      "utf8",
    );
    assert.match(
      claudeWrapper,
      /interactive_base_marker="CLAUDE_INTERACTIVE_TRACE_OK"[\s\S]+printf -v interactive_command[\s\S]+claude %q --permission-mode dontAsk --strict-mcp-config --tools default[\s\S]+"Reply exactly: \$interactive_base_marker"/,
      "Claude TUI capture must put the documented positional initial prompt before the variadic --tools option",
    );
    assert.doesNotMatch(
      claudeWrapper,
      /send_interactive_prompt "Reply exactly: \$interactive_base_marker"/,
      "Claude base capture must not depend on post-startup terminal keystroke injection",
    );
    assert.doesNotMatch(
      claudeWrapper,
      /default_models=\(/,
      "Claude capture must discover its model inventory from current request evidence",
    );
    assert.match(claudeWrapper, /discover-claude-models\.cjs/);
    assert.match(claudeWrapper, /discover-claude-model-aliases\.cjs/);
    assert.match(claudeWrapper, /CLAUDE_MODEL_DISCOVERY_/);
    assert.match(claudeWrapper, /"\$headless_trace_dir" "\$preview_dir" non-interactive/);
    assert.match(claudeWrapper, /"\$interactive_trace_dir" "\$preview_dir" interactive/);
    assert.doesNotMatch(claudeWrapper, /session_title_prompt_markers/);
    assert.match(claudeWrapper, /CAPTURE_SURFACE_INVENTORY/);
  }

  {
    for (const name of ["capture-grok.sh", "capture-antigravity.sh"]) {
      assert.match(
        fs.readFileSync(path.join(scripts, name), "utf8"),
        /CAPTURE_SURFACE_INVENTORY/,
        `${name} must emit trusted captured-surface observations`,
      );
    }
    assert.match(
      fs.readFileSync(path.join(scripts, "capture-grok.sh"), "utf8"),
      /source-surface-inventory\.cjs/,
      "Grok must inventory its public source surfaces as well as live requests",
    );
    const qwen = fs.readFileSync(path.join(scripts, "capture-qwen-code.sh"), "utf8");
    assert.match(qwen, /source-surface-inventory\.cjs/);
    assert.doesNotMatch(qwen, /packages\/core\/src\/core\/prompts\.ts/);
    const captureTool = fs.readFileSync(path.join(scripts, "capture-tool.sh"), "utf8");
    assert.match(captureTool, /source-surface-inventory\.cjs[\s\S]+codex-rs/);
    const versionCheck = fs.readFileSync(path.join(scripts, "check-versions.sh"), "utf8");
    assert.match(versionCheck, /append-runtime-refreshes\.cjs/);
    assert.match(versionCheck, /runtime-refresh-candidates\.json/);
    assert.match(
      fs.readFileSync(path.join(scripts, "../workflows/daily-refresh.yml"), "utf8"),
      /matrix\.runtime_refresh != true/,
      "runtime surface refreshes must bypass stale capture caches",
    );
    assert.match(
      fs.readFileSync(path.join(scripts, "../workflows/daily-refresh.yml"), "utf8"),
      /name: Package reviewed patch[\s\S]*?CAPTURE_SCRATCH_DIR: \$\{\{ github\.workspace \}\}\/capture-output/,
      "the packaging validator must read the verified capture evidence tree",
    );
  }

  {
    const testCase = makeCase("newest");
    artifact(testCase.downloads, 1, { status: "retry_capture" });
    artifact(testCase.downloads, 2);
    const selected = select(testCase.root, testCase.downloads, state(), 2);
    assert.equal(selected.result.status, 0, selected.result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(selected.output, "codex", "result.json"))).status, "captured");
    assert.equal(fs.readFileSync(path.join(selected.output, "codex", "evidence", "source.txt"), "utf8"), "attempt 2\n");
    assert.equal(fs.existsSync(path.join(selected.output, "codex", "workflow-run.json")), false);
  }

  {
    const testCase = makeCase("force-once");
    artifact(testCase.downloads, 1);
    artifact(testCase.downloads, 2, { source: "positive_cache" });
    artifact(testCase.downloads, 3);
    const pending = state(stateEntry({
      state: "force_once",
      request_after_run_id: "100",
      request_after_run_attempt: 1,
      reason: "reviewer",
    }));
    const selected = select(testCase.root, testCase.downloads, pending, 3);
    assert.equal(selected.result.status, 0, selected.result.stderr);
    assert.equal(fs.readFileSync(path.join(selected.output, "codex", "evidence", "source.txt"), "utf8"), "attempt 3\n");
  }

  {
    const testCase = makeCase("suppression");
    artifact(testCase.downloads, 1, { source: "positive_cache" });
    artifact(testCase.downloads, 2, { source: "retry_cache", status: "retry_capture" });
    const suppressed = state(stateEntry({
      state: "suppress_positive",
      last_fresh_bucket: "20260806",
      last_reviewer_input_hash: "c".repeat(64),
      reason: "reviewer",
    }));
    const selected = select(testCase.root, testCase.downloads, suppressed, 2);
    assert.equal(selected.result.status, 0, selected.result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(selected.output, "codex", "result.json"))).status, "retry_capture");
  }

  {
    const testCase = makeCase("manual-force");
    artifact(testCase.downloads, 1);
    artifact(testCase.downloads, 2, { forced: true });
    const selected = select(testCase.root, testCase.downloads, state(), 2, true);
    assert.equal(selected.result.status, 0, selected.result.stderr);
    assert.equal(fs.readFileSync(path.join(selected.output, "codex", "evidence", "source.txt"), "utf8"), "attempt 2\n");
  }

  {
    const testCase = makeCase("single-artifact-flattened-download");
    const directory = artifact(testCase.downloads, 1, { forced: true });
    for (const name of fs.readdirSync(directory)) {
      fs.renameSync(path.join(directory, name), path.join(testCase.downloads, name));
    }
    fs.rmdirSync(directory);
    const selected = select(testCase.root, testCase.downloads, state(), 1, true);
    assert.equal(selected.result.status, 0, selected.result.stderr);
    assert.equal(fs.readFileSync(path.join(selected.output, "codex", "evidence", "source.txt"), "utf8"), "attempt 1\n");
    assert.equal(fs.existsSync(path.join(selected.output, "codex", "workflow-run.json")), false);
  }

  {
    const testCase = makeCase("tamper");
    const directory = artifact(testCase.downloads, 1);
    fs.appendFileSync(path.join(directory, "evidence", "source.txt"), "tampered\n");
    const selected = select(testCase.root, testCase.downloads, state(), 1);
    assert.notEqual(selected.result.status, 0);
    assert.match(selected.result.stderr, /metadata or digest is invalid/);
  }

  {
    const testCase = makeCase("future");
    artifact(testCase.downloads, 2);
    const selected = select(testCase.root, testCase.downloads, state(), 1);
    assert.notEqual(selected.result.status, 0);
    assert.match(selected.result.stderr, /metadata or digest is invalid/);
  }

  {
    const testCase = makeCase("invalid-source-status");
    const directory = path.join(testCase.downloads, "capture-bundle-codex-attempt-1");
    fs.mkdirSync(directory, { recursive: true });
    writeJson(path.join(directory, "result.json"), {
      tool: "codex",
      target_version: "1.0.1",
      status: "retry_capture",
      message: "retry_capture",
      capture_contract_hash: contractHash,
      plan_hash: planHash,
    });
    const rejected = run(writer, [
      directory, "codex", planHash, "100", "1", "positive_cache", "false", "false", "20260806",
    ]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /inconsistent/);
  }

  console.log("capture artifact selection regression tests passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
