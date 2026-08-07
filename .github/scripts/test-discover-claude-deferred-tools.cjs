#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const script = path.resolve(__dirname, "../../claude-code/misc/scripts/discover-claude-deferred-tools.cjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-autopsy-claude-deferred-"));

function run(marker) {
  return childProcess.spawnSync(process.execPath, [script, temp, marker], { encoding: "utf8" });
}

try {
  // Invalid and incomplete files may coexist with the atomically completed
  // trace and must not hide newly advertised tools.
  fs.writeFileSync(path.join(temp, "000-truncated.json"), "{");
  fs.writeFileSync(path.join(temp, "001-failed.json"), JSON.stringify({
    request: { body: JSON.stringify({ messages: [{ content: "MARKER" }] }) },
    response: { ok: false, completed: true, error_event: true },
  }));
  fs.writeFileSync(path.join(temp, "002-valid.json"), JSON.stringify({
    request: {
      body: JSON.stringify({
        messages: [{
          content: [
            { type: "text", text: "MARKER" },
            {
              type: "text",
              text: [
                "<system-reminder>",
                "The following deferred tools are available via ToolSearch:",
                "- WebSearch",
                "- BrandNewTool",
                "`AnotherTool` and 'QuotedTool'",
                "DeferredToolPlaceholder JSONSchema SystemReminder ToolSearch",
                "</system-reminder>",
              ].join("\n"),
            },
          ],
        }],
      }),
    },
    response: { ok: true, completed: true, error_event: false },
  }));

  const discovered = run("MARKER");
  assert.equal(discovered.status, 0, discovered.stderr);
  assert.deepEqual(discovered.stdout.trim().split(/\r?\n/), [
    "AnotherTool", "BrandNewTool", "QuotedTool", "WebSearch",
  ]);

  const missing = run("MISSING_MARKER");
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /no successful base request contained marker/);

  const unsafeMarker = run("bad marker");
  assert.equal(unsafeMarker.status, 2);

  console.log("Claude deferred-tool discovery regression tests passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
