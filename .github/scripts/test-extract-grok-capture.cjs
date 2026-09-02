const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const extractor = path.join(__dirname, "../../grok/misc/scripts/extract-grok-capture.cjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "extract-grok-capture-"));
const capture = path.join(temp, "capture.jsonl");
const output = path.join(temp, "candidate");
const inventory = path.join(temp, "surface-observations.json");

function record(body, marker = null) {
  return {
    url: "https://api.x.ai/v1/responses",
    request_body: JSON.stringify(body),
    capture_marker: marker,
    response_status: 200,
    response_complete: true,
    response_markers: marker ? [marker] : [],
  };
}

function body(model, system, tools, query) {
  return {
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: `<user_query>\n${query}\n</user_query>` },
    ],
    tools,
  };
}

const readTool = { type: "function", name: "read_file", description: "Read", parameters: { type: "object" } };
const titleTool = { type: "function", name: "session_title", description: "Title", parameters: { type: "object" } };
const records = [
  record(body("grok-current", "You are an autonomous agent", [readTool], "GROK_TRACE_OK"), "GROK_TRACE_OK"),
  record(body("grok-current", "You are an interactive CLI tool", [readTool], "GROK_INTERACTIVE_TRACE_OK"), "GROK_INTERACTIVE_TRACE_OK"),
  record(body("grok-title", "Title this session", [titleTool], "session")),
];
fs.writeFileSync(capture, `${records.map((value) => JSON.stringify(value)).join("\n")}\n`);

const result = childProcess.spawnSync(process.execPath, [extractor, capture, output], {
  encoding: "utf8",
  env: {
    ...process.env,
    CAPTURE_TARGET_VERSION: "4.3.2",
    CAPTURE_SURFACE_INVENTORY: inventory,
  },
});

test("Grok extraction emits model and mode surfaces from request bodies", () => {
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(fs.readFileSync(inventory, "utf8"));
  assert.equal(value.observed_release, "4.3.2");
  assert.ok(value.surfaces.find((surface) => surface.id === "grok.prompt.agent.grok-current.non-interactive"));
  assert.ok(value.surfaces.find((surface) => surface.id === "grok.prompt.agent.grok-current.interactive"));
  const title = value.surfaces.find((surface) => surface.id === "grok.prompt.special.session-title");
  assert.deepEqual(title.models, ["grok-title"]);
  const tools = value.surfaces.find((surface) => surface.id === "grok.tool.catalog");
  assert.deepEqual(tools.models, ["grok-current", "grok-title"]);
  assert.deepEqual(tools.modes, ["interactive", "non-interactive", "session-title"]);
});

test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
