const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const extractor = path.join(__dirname, "../../antigravity/misc/scripts/extract-antigravity-log.cjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "extract-antigravity-log-"));
const output = path.join(temp, "candidate");
const inventory = path.join(temp, "surface-observations.json");
const plan = path.join(temp, "plan.json");
const binary = path.join(temp, "agy");
fs.writeFileSync(binary, "#!/bin/sh\necho 'Antigravity 1.2.3'\n");
fs.chmodSync(binary, 0o755);
fs.writeFileSync(plan, JSON.stringify([{
  tool: "antigravity",
  new_version: "1.2.3",
  artifact_url: "https://example.invalid/antigravity.tar.gz",
  artifact_sha512: "a".repeat(128),
}]));

const tool = {
  functionDeclarations: [{
    name: "read_file",
    description: "Read a file",
    parameters: { type: "object" },
  }],
};

function writeCapture(name, marker) {
  const file = path.join(temp, `${name}.jsonl`);
  const payload = {
    requestType: "agent",
    model: "gemini-current",
    request: {
      systemInstruction: { parts: [{ text: `System prompt ${marker}` }] },
      contents: [{ role: "user", parts: [{ text: marker }] }],
      tools: [tool],
    },
  };
  fs.writeFileSync(file, `${JSON.stringify({
    url: "https://example.invalid/v1internal:streamGenerateContent",
    request_body: JSON.stringify(payload),
    capture_marker: marker,
    response_status: 200,
    response_complete: true,
    response_markers: [marker],
  })}\n`);
  return file;
}

function run(file, mode) {
  return childProcess.spawnSync(process.execPath, [extractor, file, output], {
    encoding: "utf8",
    env: {
      ...process.env,
      AGY_CAPTURE_BINARY: binary,
      AGY_CAPTURE_MODE: mode,
      CHANGED_TOOLS_FILE: plan,
      CAPTURE_SURFACE_INVENTORY: inventory,
    },
  });
}

const noninteractive = run(writeCapture("noninteractive", "ANTIGRAVITY_TRACE_OK"), "non-interactive");
const interactive = run(writeCapture("interactive", "ANTIGRAVITY_INTERACTIVE_TRACE_OK"), "interactive");

test("Antigravity extraction merges request-derived models and modes", () => {
  assert.equal(noninteractive.status, 0, noninteractive.stderr);
  assert.equal(interactive.status, 0, interactive.stderr);
  const value = JSON.parse(fs.readFileSync(inventory, "utf8"));
  assert.equal(value.observed_release, "1.2.3");
  assert.ok(value.surfaces.find((surface) => surface.id === "antigravity.prompt.agent.gemini-current.non-interactive"));
  assert.ok(value.surfaces.find((surface) => surface.id === "antigravity.prompt.agent.gemini-current.interactive"));
  const tools = value.surfaces.find((surface) => surface.id === "antigravity.tool.catalog");
  assert.deepEqual(tools.models, ["gemini-current"]);
  assert.deepEqual(tools.modes, ["interactive", "non-interactive"]);
  assert.deepEqual(tools.artifacts, ["tools/read_file.json"]);
});

test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
