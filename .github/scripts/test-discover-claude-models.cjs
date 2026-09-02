const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = path.join(__dirname, "../../claude-code/misc/scripts/discover-claude-models.cjs");

function traceRecord(body) {
  return {
    request: { body: JSON.stringify(body) },
    response: { ok: true, completed: true, error_event: false, status: 200 },
  };
}

function run(records, registry = null) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "discover-claude-models-"));
  records.forEach((record, index) => {
    fs.writeFileSync(path.join(temp, `${index}.json`), JSON.stringify(record));
  });
  let registryPath;
  if (registry) {
    registryPath = path.join(temp, "SURFACES.json");
    fs.writeFileSync(registryPath, JSON.stringify(registry));
  }
  const result = childProcess.spawnSync(process.execPath, [script, temp, ...(registryPath ? [registryPath] : [])], {
    encoding: "utf8",
  });
  fs.rmSync(temp, { recursive: true, force: true });
  return result;
}

test("discovers the quoted current inventory without a fixed model list", () => {
  const result = run([traceRecord({
    model: "claude-sonnet-5",
    tools: [{ name: "Read" }],
    messages: [{ role: "user", content: "Reply exactly: CLAUDE_INTERACTIVE_TRACE_OK" }],
    system: [{ text: "A false example claude-1001. Model IDs: 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5'." }],
  })]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    "claude-fable-5-1",
    "claude-opus-5",
    "claude-sonnet-5",
  ]);
});

test("falls back to prior evidence-backed surfaces when the release has no quoted inventory", () => {
  const result = run([traceRecord({
    model: "claude-sonnet-4-6",
    tools: [{ name: "Read" }],
    messages: [{ role: "user", content: "CLAUDE_INTERACTIVE_TRACE_OK" }],
    system: "You are Claude Code.",
  })], {
    surfaces: [{
      category: "agent prompt",
      modes: ["non-interactive"],
      models: ["claude-opus-4-8"],
    }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), ["claude-opus-4-8", "claude-sonnet-4-6"]);
});

test("rejects incomplete marker evidence", () => {
  const record = traceRecord({ model: "claude-sonnet-5", tools: [{ name: "Read" }], messages: [] });
  record.response.completed = false;
  const result = run([record]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No completed Claude interactive marker request/);
});
