const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = path.join(__dirname, "../../claude-code/misc/scripts/discover-claude-model-aliases.cjs");

function record(body, completed = true) {
  return {
    request: { body: JSON.stringify(body) },
    response: { ok: true, completed, error_event: false, status: 200 },
  };
}

function run(records) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "discover-claude-aliases-"));
  records.forEach((value, index) => fs.writeFileSync(path.join(temp, `${index}.json`), JSON.stringify(value)));
  const result = childProcess.spawnSync(process.execPath, [script, temp], { encoding: "utf8" });
  fs.rmSync(temp, { recursive: true, force: true });
  return result;
}

test("discovers future model aliases from successful tool schemas", () => {
  const result = run([record({
    messages: [{ role: "user", content: "CLAUDE_INTERACTIVE_TRACE_OK" }],
    tools: [{
      name: "Delegate",
      input_schema: {
        type: "object",
        properties: {
          model: { type: "string", enum: ["future", "swift"] },
        },
      },
    }],
  })]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), ["future", "swift"]);
});

test("rejects incomplete marker evidence", () => {
  const result = run([record({
    messages: [{ role: "user", content: "CLAUDE_INTERACTIVE_TRACE_OK" }],
    tools: [{ input_schema: { properties: { model: { type: "string", enum: ["future"] } } } }],
  }, false)]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No completed Claude interactive marker request/);
});
