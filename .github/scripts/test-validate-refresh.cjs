const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const validator = path.join(__dirname, "validate-refresh.cjs");
const countUpdater = path.join(__dirname, "update-version-counts.cjs");

function runValidator(root, plan, summary) {
  return childProcess.spawnSync(process.execPath, [validator, plan, summary], {
    cwd: root,
    encoding: "utf8",
  });
}

test("same-version plans require an explicit request-backed runtime refresh", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "validate-runtime-refresh-"));
  const root = path.join(temp, "repo");
  const provider = path.join(root, "codex");
  fs.mkdirSync(provider, { recursive: true });
  fs.writeFileSync(path.join(provider, "VERSION"), "codex_cli_package_version = 1.0.0\n");
  fs.writeFileSync(path.join(provider, "SURFACES.json"), JSON.stringify({
    surfaces: [{ status: "current", capture_method: "direct-source" }],
  }));
  childProcess.execFileSync("git", ["init", "-q"], { cwd: root });
  childProcess.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  childProcess.execFileSync("git", ["config", "user.name", "Validation Test"], { cwd: root });
  childProcess.execFileSync("git", ["add", "."], { cwd: root });
  childProcess.execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });
  const plan = path.join(temp, "plan.json");
  const summary = path.join(temp, "summary.md");
  fs.writeFileSync(summary, "## codex\n\nChecked Codex.\n");

  fs.writeFileSync(plan, JSON.stringify([{
    tool: "codex", dir: "codex", old_version: "1.0.0", new_version: "1.0.0",
  }]));
  const implicit = runValidator(root, plan, summary);
  assert.notEqual(implicit.status, 0);
  assert.match(implicit.stderr, /same-version plan must be an explicit runtime_refresh/);

  fs.writeFileSync(plan, JSON.stringify([{
    tool: "codex", dir: "codex", old_version: "1.0.0", new_version: "1.0.0", runtime_refresh: true,
  }]));
  const sourceOnly = runValidator(root, plan, summary);
  assert.notEqual(sourceOnly.status, 0);
  assert.match(sourceOnly.stderr, /runtime_refresh requires a current model-request surface/);
});

test("Grok VERSION model tool field follows prompt_models", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "validate-refresh-grok-"));
  const root = path.join(temp, "repo");
  fs.mkdirSync(root);
  const grok = path.join(root, "grok");
  const tools = path.join(grok, "tools");
  fs.mkdirSync(tools, { recursive: true });
  fs.writeFileSync(path.join(tools, "agent.json"), "{}\n");
  fs.writeFileSync(path.join(tools, "session-title.json"), "{}\n");
  fs.writeFileSync(
    path.join(grok, "VERSION"),
    "version = 1.0.0\nprompt_models = grok-4.5\ntools = 2\ngrok_4_5_tools = 1\ngrok_session_title_tools = 1\n",
  );
  childProcess.execFileSync("git", ["init", "-q"], { cwd: root });
  childProcess.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  childProcess.execFileSync("git", ["config", "user.name", "Validation Test"], { cwd: root });
  childProcess.execFileSync("git", ["add", "--", "grok"], { cwd: root });
  childProcess.execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });

  const plan = path.join(temp, "plan.json");
  const summary = path.join(temp, "summary.md");
  fs.writeFileSync(plan, JSON.stringify([{ tool: "grok", dir: "grok", old_version: "1.0.0", new_version: "1.0.1" }]));
  fs.writeFileSync(summary, "## grok\n\nUpdated Grok.\n");

  fs.writeFileSync(
    path.join(grok, "VERSION"),
    "version = 1.0.1\nprompt_models = grok-4.6\ntools = 2\ngrok_4_5_tools = 1\ngrok_session_title_tools = 1\n",
  );
  const stale = runValidator(root, plan, summary);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /must use grok_4_6_tools/);
  assert.match(stale.stderr, /retains stale model tool field grok_4_5_tools/);

  fs.writeFileSync(
    path.join(grok, "VERSION"),
    "version = 1.0.1\nprompt_models = grok-4.6\ntools = 2\ngrok_4_6_tools = 1\ngrok_session_title_tools = 1\n",
  );
  const current = runValidator(root, plan, summary);
  assert.equal(current.status, 0, current.stderr);
});

test("VERSION metadata excludes transport fields and unsupported Antigravity executable digests", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "validate-refresh-antigravity-"));
  const root = path.join(temp, "repo");
  const provider = path.join(root, "antigravity");
  const misc = path.join(provider, "misc");
  fs.mkdirSync(misc, { recursive: true });
  fs.writeFileSync(path.join(provider, "VERSION"), "version = 1.0.0\nmanifest_tarball_sha512 = trusted\n");
  fs.writeFileSync(path.join(misc, "interactive-capture.VERSION"), "version = 1.0.0\ntrace_script = antigravity/misc/scripts/extract.cjs\n");
  childProcess.execFileSync("git", ["init", "-q"], { cwd: root });
  childProcess.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  childProcess.execFileSync("git", ["config", "user.name", "Validation Test"], { cwd: root });
  childProcess.execFileSync("git", ["add", "--", "antigravity"], { cwd: root });
  childProcess.execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });

  const plan = path.join(temp, "plan.json");
  const summary = path.join(temp, "summary.md");
  fs.writeFileSync(plan, JSON.stringify([{ tool: "antigravity", dir: "antigravity", old_version: "1.0.0", new_version: "1.0.1" }]));
  fs.writeFileSync(summary, "## antigravity\n\nUpdated Antigravity.\n");
  fs.writeFileSync(path.join(provider, "VERSION"), "version = 1.0.1\nmanifest_tarball_sha512 = trusted\n");
  fs.writeFileSync(
    path.join(misc, "interactive-capture.VERSION"),
    "version = 1.0.1\ngenerated_at = now\ntrace_source = local.log\ntrace_script = antigravity/misc/scripts/extract.cjs\nsha256 = unsupported\n",
  );
  const unsafe = runValidator(root, plan, summary);
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /transport-only field generated_at/);
  assert.match(unsafe.stderr, /transport-only field trace_source/);
  assert.match(unsafe.stderr, /unsupported executable digest field sha256/);

  fs.writeFileSync(
    path.join(misc, "interactive-capture.VERSION"),
    "version = 1.0.1\ntrace_script = antigravity/misc/scripts/extract.cjs\n",
  );
  const safe = runValidator(root, plan, summary);
  assert.equal(safe.status, 0, safe.stderr);
});

test("trusted VERSION count update excludes misc VERSION metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "update-version-counts-"));
  const provider = path.join(root, "antigravity");
  fs.mkdirSync(path.join(provider, "prompts"), { recursive: true });
  fs.mkdirSync(path.join(provider, "tools"), { recursive: true });
  fs.mkdirSync(path.join(provider, "misc"), { recursive: true });
  fs.writeFileSync(path.join(provider, "prompts", "one.md"), "prompt\n");
  fs.writeFileSync(path.join(provider, "tools", "one.json"), "{}\n");
  fs.writeFileSync(path.join(provider, "misc", "interactive-capture.VERSION"), "version = 1.0.1\n");
  fs.writeFileSync(path.join(provider, "misc", "artifact.md"), "artifact\n");
  fs.writeFileSync(path.join(provider, "VERSION"), "version = 1.0.1\nprompts = 9\ntools = 9\nmisc = 9\n");
  childProcess.execFileSync("git", ["init", "-q"], { cwd: root });
  const result = childProcess.spawnSync(process.execPath, [countUpdater, "antigravity"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const version = fs.readFileSync(path.join(provider, "VERSION"), "utf8");
  assert.match(version, /^prompts = 1$/m);
  assert.match(version, /^tools = 1$/m);
  assert.match(version, /^misc = 1$/m);
});

test("a Codex advance cannot ignore an unresolved artifact source map entry", () => {
  // The 0.149.0 refresh advanced the release while leaving
  // misc/permissions-approval-policy-unless-trusted.md at its 0.148.0 wording,
  // even though the map had flagged that text as absent from the new source.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "validate-refresh-codex-map-"));
  const root = path.join(temp, "repo");
  const codex = path.join(root, "codex");
  const misc = path.join(codex, "misc");
  fs.mkdirSync(misc, { recursive: true });
  fs.writeFileSync(path.join(misc, "drifted.md"), "the old wording\n");
  fs.writeFileSync(
    path.join(codex, "VERSION"),
    "codex_cli_package_version = 0.148.0\nprompts = 0\ntools = 0\nmisc = 1\n",
  );
  childProcess.execFileSync("git", ["init", "-q"], { cwd: root });
  childProcess.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  childProcess.execFileSync("git", ["config", "user.name", "Validation Test"], { cwd: root });
  childProcess.execFileSync("git", ["add", "--", "codex"], { cwd: root });
  childProcess.execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });

  const scratch = path.join(temp, "scratch");
  fs.mkdirSync(path.join(scratch, "codex", "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(scratch, "codex", "evidence", "artifact-source-map.json"),
    JSON.stringify({
      schema_version: 1,
      artifacts: [],
      unresolved: [{ artifact: "misc/drifted.md", reason: "probe not found at the new revision" }],
    }),
  );

  const plan = path.join(temp, "plan.json");
  const summary = path.join(temp, "summary.md");
  fs.writeFileSync(plan, JSON.stringify([{
    tool: "codex",
    dir: "codex",
    old_version: "0.148.0",
    new_version: "0.149.0",
    version_field: "codex_cli_package_version",
  }]));
  fs.writeFileSync(summary, "## codex\n\nAdvanced Codex.\n");

  function run() {
    return childProcess.spawnSync(process.execPath, [validator, plan, summary], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CAPTURE_SCRATCH_DIR: scratch },
    });
  }

  // Advancing the release without touching the flagged artifact is refused.
  fs.writeFileSync(
    path.join(codex, "VERSION"),
    "codex_cli_package_version = 0.149.0\nprompts = 0\ntools = 0\nmisc = 1\n",
  );
  const ignored = run();
  assert.notEqual(ignored.status, 0);
  assert.match(ignored.stderr, /codex\/misc\/drifted\.md/);
  assert.match(ignored.stderr, /must be re-derived from the source checkout/);

  // Re-deriving the artifact clears the gate.
  fs.writeFileSync(path.join(misc, "drifted.md"), "the new wording\n");
  const rederived = run();
  assert.equal(rederived.status, 0, rederived.stderr);

  // Holding the release at its old version is also allowed.
  fs.writeFileSync(path.join(misc, "drifted.md"), "the old wording\n");
  fs.writeFileSync(
    path.join(codex, "VERSION"),
    "codex_cli_package_version = 0.148.0\nprompts = 0\ntools = 0\nmisc = 1\n",
  );
  const held = run();
  assert.equal(held.status, 0, held.stderr);
});

test("a live release cannot omit or rename a captured surface", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "validate-refresh-observed-surfaces-"));
  const root = path.join(temp, "repo");
  const provider = path.join(root, "antigravity");
  fs.mkdirSync(path.join(provider, "prompts"), { recursive: true });
  fs.mkdirSync(path.join(provider, "tools"), { recursive: true });
  fs.writeFileSync(path.join(provider, "VERSION"), "version = 1.0.1\nprompts = 1\ntools = 1\nmisc = 0\n");
  fs.writeFileSync(path.join(provider, "prompts", "gemini-new.md"), "current prompt\n");
  fs.writeFileSync(path.join(provider, "tools", "read.json"), "{}\n");

  function artifactDigest(artifacts) {
    const hash = crypto.createHash("sha256");
    for (const relative of artifacts) {
      hash.update(relative);
      hash.update("\0");
      hash.update(fs.readFileSync(path.join(provider, relative)));
      hash.update("\0");
    }
    return hash.digest("hex");
  }

  const privacy = {
    tracked_content: "derived-normalized-only",
    tracked_raw_requests: false,
    tracked_request_headers: false,
    tracked_user_messages: false,
    tracked_model_responses: false,
    tracked_machine_state: true,
    unknown_fields: "reject",
  };
  fs.writeFileSync(path.join(provider, "SURFACES.json"), JSON.stringify({
    schema_version: 1,
    provider: "antigravity",
    observed_release: "1.0.1",
    privacy,
    surfaces: [
      {
        id: "antigravity.prompt.agent.gemini-old.non-interactive",
        category: "agent prompt",
        status: "current",
        capture_method: "model-request",
        captured_release: "1.0.1",
        verified_release: "1.0.1",
        models: ["gemini-new"],
        modes: ["non-interactive"],
        dynamic_inputs: [],
        artifacts: ["prompts/gemini-new.md"],
        artifact_sha256: artifactDigest(["prompts/gemini-new.md"]),
        evidence_sha256: "a".repeat(64),
      },
      {
        id: "antigravity.tool.catalog",
        category: "tool schemas",
        status: "current",
        capture_method: "model-request",
        captured_release: "1.0.1",
        verified_release: "1.0.1",
        models: ["gemini-new"],
        modes: ["non-interactive"],
        dynamic_inputs: [],
        artifacts: ["tools/read.json"],
        artifact_sha256: artifactDigest(["tools/read.json"]),
        evidence_sha256: "a".repeat(64),
      },
    ],
  }, null, 2));
  childProcess.execFileSync("git", ["init", "-q"], { cwd: root });
  childProcess.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  childProcess.execFileSync("git", ["config", "user.name", "Validation Test"], { cwd: root });
  childProcess.execFileSync("git", ["add", "."], { cwd: root });
  childProcess.execFileSync("git", ["commit", "-qm", "baseline"], { cwd: root });

  const scratch = path.join(temp, "scratch");
  fs.mkdirSync(path.join(scratch, "antigravity", "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(scratch, "antigravity", "evidence", "surface-observations.json"),
    JSON.stringify({
      schema_version: 1,
      provider: "antigravity",
      observed_release: "1.0.1",
      authority: "model-request",
      complete: true,
      surfaces: [
        {
          id: "antigravity.prompt.agent.gemini-new.non-interactive",
          category: "agent prompt",
          models: ["gemini-new"],
          modes: ["non-interactive"],
          artifacts: ["prompts/gemini-new.md"],
        },
        {
          id: "antigravity.tool.catalog",
          category: "tool schemas",
          models: ["gemini-new"],
          modes: ["non-interactive"],
          artifacts: ["tools/read.json"],
        },
      ],
    }),
  );
  const plan = path.join(temp, "plan.json");
  const summary = path.join(temp, "summary.md");
  fs.writeFileSync(plan, JSON.stringify([{
    tool: "antigravity", dir: "antigravity", old_version: "1.0.0", new_version: "1.0.1",
  }]));
  fs.writeFileSync(summary, "## antigravity\n\nUpdated Antigravity.\n");

  const result = childProcess.spawnSync(process.execPath, [validator, plan, summary], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CAPTURE_SCRATCH_DIR: scratch },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /observed surface antigravity\.prompt\.agent\.gemini-new\.non-interactive is absent/);
  assert.match(result.stderr, /current model-request surface antigravity\.prompt\.agent\.gemini-old\.non-interactive has no captured observation/);
});
