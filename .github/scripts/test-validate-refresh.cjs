const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const validator = path.join(__dirname, "validate-refresh.cjs");

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
