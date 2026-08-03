#!/usr/bin/env node

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const extractor = path.join(repoRoot, "grok", "misc", "scripts", "extract-grok-capture.cjs");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-autopsy-grok-"));

const requestBody = {
  model: "grok-4.5",
  messages: [
    { role: "system", content: "You are an autonomous agent\nWorkspace Path: /tmp/example\n" },
    { role: "user", content: "<user_query>\nhello\n</user_query>" },
  ],
  tools: [{
    type: "function",
    function: { name: "read_file", parameters: { type: "object" } },
  }],
};

function run(record, name) {
  const capture = path.join(tempDir, `${name}.jsonl`);
  const output = path.join(tempDir, name);
  fs.writeFileSync(capture, `${JSON.stringify(record)}\n`);
  return childProcess.spawnSync(process.execPath, [extractor, capture, output], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

try {
  const responseBacked = run({
    url: "https://cli-chat-proxy.grok.com/v1/chat/completions",
    request_body: JSON.stringify(requestBody),
    response_status: 200,
  }, "response-backed");
  assert.strictEqual(responseBacked.status, 0, responseBacked.stderr);
  assert.ok(fs.existsSync(path.join(tempDir, "response-backed", "prompts", "grok-4.5.md")));
  assert.ok(fs.existsSync(path.join(tempDir, "response-backed", "tools", "read_file.json")));

  const requestOnly = run({
    url: "https://cli-chat-proxy.grok.com/v1/chat/completions",
    request_body: JSON.stringify(requestBody),
  }, "request-only");
  assert.notStrictEqual(requestOnly.status, 0, "request-only evidence must be rejected");
  assert.match(requestOnly.stderr, /lack response_status/);

  console.log("Grok capture extractor regression tests passed");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
