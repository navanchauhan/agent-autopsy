#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const traceDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-autopsy-claude-trace-"));
process.env.CLAUDE_TRACE_DIR = traceDir;

const responseBody = 'event: message_stop\ndata: {"type":"message_stop"}\n';
globalThis.fetch = async () =>
  new Response(responseBody, {
    status: 200,
    headers: {
      authorization: "response-value",
      "x-observed": "response-header",
    },
  });

require(path.resolve(
  __dirname,
  "../../claude-code/misc/scripts/trace-claude-messages.cjs",
));

async function readCompletedRecord() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const files = fs.readdirSync(traceDir).filter((name) => name.endsWith(".json"));
    if (files.length === 1) {
      const text = fs.readFileSync(path.join(traceDir, files[0]), "utf8");
      const record = JSON.parse(text);
      if (record.response?.completed) return { record, text };
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("trace record did not reach completed state");
}

test("records redacted response completion without consuming the caller response", async (t) => {
  t.after(() => fs.rmSync(traceDir, { recursive: true, force: true }));

  const response = await fetch("https://api.anthropic.com/v1/messages?beta=true", {
    method: "POST",
    headers: {
      authorization: "request-value",
      "x-observed": "request-header",
    },
    body: '{"stream":true}',
  });
  assert.equal(await response.text(), responseBody);

  const { record, text } = await readCompletedRecord();
  assert.equal(record.request.headers.authorization, "***");
  assert.equal(record.request.headers["x-observed"], "request-header");
  assert.equal(record.response.status, 200);
  assert.equal(record.response.ok, true);
  assert.equal(record.response.completed, true);
  assert.equal(record.response.terminal_event, true);
  assert.equal(record.response.error_event, false);
  assert.equal(record.response.headers.authorization, "***");
  assert.equal(record.response.headers["x-observed"], "response-header");
  assert.equal(text.includes("request-value"), false);
  assert.equal(text.includes("response-value"), false);
  assert.equal(text.includes(responseBody), false);
});
