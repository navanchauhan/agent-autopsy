const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const extractor = path.join(__dirname, "../../claude-code/misc/scripts/extract-claude-trace.cjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "extract-claude-trace-"));
const headless = path.join(temp, "headless");
const interactive = path.join(temp, "interactive");
const output = path.join(temp, "candidate");
const inventory = path.join(temp, "surface-observations.json");
for (const directory of [headless, interactive, output]) fs.mkdirSync(directory, { recursive: true });

function record(body) {
  return {
    request: { headers: { "user-agent": "claude-cli/9.8.7" }, body: JSON.stringify(body) },
    response: { status: 200, ok: true, completed: true, terminal_event: true, error_event: false },
  };
}

function write(directory, name, body) {
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(record(body)));
}

const tool = { name: "Read", description: "Read a file", input_schema: { type: "object" } };
write(headless, "agent", {
  model: "claude-fable-5-1",
  system: [{ text: "x-anthropic-billing-header: cc_version=9.8.7; cc_entrypoint=cli; cch=123;\nHeadless prompt" }],
  tools: [tool],
  messages: [{ role: "user", content: "Reply exactly: TRACE_FETCH_claude-fable-5-1" }],
});
write(interactive, "agent", {
  model: "claude-sonnet-5",
  system: [{ text: "Interactive prompt" }],
  tools: [tool],
  messages: [{ role: "user", content: "Reply exactly: CLAUDE_INTERACTIVE_TRACE_OK" }],
});
write(interactive, "title", {
  model: "claude-haiku-4-5-20251001",
  system: [{ text: "Session title prompt" }],
  tools: [],
  messages: [{ role: "user", content: "<session>CLAUDE_INTERACTIVE_TRACE_OK</session>" }],
});

function extract(directory, mode) {
  return childProcess.spawnSync(process.execPath, [extractor, directory, output, mode], {
    encoding: "utf8",
    env: {
      ...process.env,
      CAPTURE_TARGET_VERSION: "9.8.7",
      CAPTURE_SURFACE_INVENTORY: inventory,
    },
  });
}

const headlessResult = extract(headless, "non-interactive");
const interactiveResult = extract(interactive, "interactive");

test("extracts current headless, interactive, and session-title prompts", () => {
  assert.equal(headlessResult.status, 0, headlessResult.stderr);
  assert.equal(interactiveResult.status, 0, interactiveResult.stderr);
  for (const name of [
    "claude-fable-5-1.md",
    "claude-sonnet-5-interactive.md",
    "claude-haiku-4-5-20251001-session-title.md",
  ]) {
    assert.ok(fs.existsSync(path.join(output, "prompts", name)), name);
  }
});

test("emits one merged evidence-driven surface inventory", () => {
  const value = JSON.parse(fs.readFileSync(inventory, "utf8"));
  assert.equal(value.provider, "claude-code");
  assert.equal(value.observed_release, "9.8.7");
  assert.equal(value.complete, true);
  assert.ok(value.surfaces.find((surface) => surface.id === "claude-code.prompt.agent.claude-fable-5-1.non-interactive"));
  assert.ok(value.surfaces.find((surface) => surface.id === "claude-code.prompt.agent.claude-sonnet-5.interactive"));
  assert.ok(value.surfaces.find((surface) => surface.id === "claude-code.prompt.special.session-title"));
  const tools = value.surfaces.find((surface) => surface.id === "claude-code.tool.catalog");
  assert.deepEqual(tools.models, ["claude-fable-5-1", "claude-sonnet-5"]);
  assert.deepEqual(tools.modes, ["interactive", "non-interactive"]);
});

test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
