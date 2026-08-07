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
    response: { status: 500, ok: false, completed: true, error_event: true },
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
    response: { status: 200, ok: true, completed: true, error_event: false },
  }));

  // Claude Code 2.1.221 emits one unquoted tool identifier per line. The
  // illustrative names after Example: are not evidence and must be ignored.
  fs.writeFileSync(path.join(temp, "003-bare-lines.json"), JSON.stringify({
    request: {
      body: JSON.stringify({
        stream: true,
        messages: [{
          content: [
            { type: "text", text: "MARKER_BARE" },
            {
              type: "text",
              text: [
                "<system-reminder>",
                "The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query \"select:<name>[,<name>...]\" to load tool schemas before calling them:",
                "CronCreate",
                "BrandNewTool",
                "Example:",
                "Read",
                "Edit",
                "- ExampleBulletTool",
                "`ExampleQuotedTool`",
                "</system-reminder>",
              ].join("\n"),
            },
          ],
        }],
      }),
    },
    response: {
      status: 200,
      ok: true,
      completed: true,
      terminal_event: true,
      error_event: false,
    },
  }));

  // A matching auxiliary request without the reminder may sort before the
  // actual base trace; discovery must inspect every validated matching trace.
  fs.writeFileSync(path.join(temp, "004-multi-first.json"), JSON.stringify({
    request: { body: JSON.stringify({ messages: [{ content: "MULTI_MARKER" }] }) },
    response: { status: 200, ok: true, completed: true, error_event: false },
  }));
  fs.writeFileSync(path.join(temp, "005-multi-evidence.json"), JSON.stringify({
    request: {
      body: JSON.stringify({
        messages: [{
          content: [
            { type: "text", text: "MULTI_MARKER" },
            { type: "text", text: "<system-reminder>Deferred tools via ToolSearch:\nLaterTool\n</system-reminder>" },
          ],
        }],
      }),
    },
    response: { status: 200, ok: true, completed: true, error_event: false },
  }));

  fs.writeFileSync(path.join(temp, "006-nonterminal.json"), JSON.stringify({
    request: {
      body: JSON.stringify({
        stream: true,
        messages: [{
          content: "NONTERMINAL_MARKER\n<system-reminder>Deferred tools via ToolSearch:\nUnsafeTool\n</system-reminder>",
        }],
      }),
    },
    response: {
      status: 200,
      ok: true,
      completed: true,
      terminal_event: false,
      error_event: false,
    },
  }));

  fs.writeFileSync(path.join(temp, "007-empty-advertisement.json"), JSON.stringify({
    request: {
      body: JSON.stringify({
        messages: [{
          content: "EMPTY_MARKER\n<system-reminder>Deferred tools are available via ToolSearch, but none are listed.</system-reminder>",
        }],
      }),
    },
    response: { status: 200, ok: true, completed: true, error_event: false },
  }));

  fs.writeFileSync(path.join(temp, "008-schema-prose.json"), JSON.stringify({
    request: {
      body: JSON.stringify({
        messages: [{ content: "SCHEMA_MARKER" }],
        tools: [{
          name: "UnrelatedTool",
          description: "<system-reminder>Deferred tools via ToolSearch:\nSchemaOnlyTool\n</system-reminder>",
        }],
      }),
    },
    response: { status: 200, ok: true, completed: true, error_event: false },
  }));

  fs.writeFileSync(path.join(temp, "009-toolsearch-prose.json"), JSON.stringify({
    request: {
      body: JSON.stringify({
        messages: [{
          content: "PROSE_MARKER\n<system-reminder>ToolSearch accepts query `BogusTool` for examples.\nActualTool\n</system-reminder>",
        }],
      }),
    },
    response: { status: 200, ok: true, completed: true, error_event: false },
  }));

  fs.writeFileSync(path.join(temp, "010-compact-list.json"), JSON.stringify({
    request: {
      body: JSON.stringify({
        messages: [{
          content: "COMPACT_MARKER\n<system-reminder>Deferred tools via ToolSearch: FirstTool, SecondTool</system-reminder>",
        }],
      }),
    },
    response: { status: 200, ok: true, completed: true, error_event: false },
  }));

  const discovered = run("MARKER");
  assert.equal(discovered.status, 0, discovered.stderr);
  assert.deepEqual(discovered.stdout.trim().split(/\r?\n/), [
    "AnotherTool", "BrandNewTool", "QuotedTool", "WebSearch",
  ]);

  const bare = run("MARKER_BARE");
  assert.equal(bare.status, 0, bare.stderr);
  assert.deepEqual(bare.stdout.trim().split(/\r?\n/), ["BrandNewTool", "CronCreate"]);

  const multi = run("MULTI_MARKER");
  assert.equal(multi.status, 0, multi.stderr);
  assert.equal(multi.stdout.trim(), "LaterTool");

  const nonterminal = run("NONTERMINAL_MARKER");
  assert.notEqual(nonterminal.status, 0);
  assert.match(nonterminal.stderr, /no successful base request contained marker/);

  const empty = run("EMPTY_MARKER");
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /advertised no deferred tool names/);

  const schemaProse = run("SCHEMA_MARKER");
  assert.notEqual(schemaProse.status, 0);
  assert.match(schemaProse.stderr, /advertised no deferred tool names/);

  const toolSearchProse = run("PROSE_MARKER");
  assert.notEqual(toolSearchProse.status, 0);
  assert.match(toolSearchProse.stderr, /advertised no deferred tool names/);

  const compact = run("COMPACT_MARKER");
  assert.equal(compact.status, 0, compact.stderr);
  assert.deepEqual(compact.stdout.trim().split(/\r?\n/), ["FirstTool", "SecondTool"]);

  const missing = run("MISSING_MARKER");
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /no successful base request contained marker/);

  const unsafeMarker = run("bad marker");
  assert.equal(unsafeMarker.status, 2);

  console.log("Claude deferred-tool discovery regression tests passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
