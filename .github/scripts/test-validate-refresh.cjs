const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
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
