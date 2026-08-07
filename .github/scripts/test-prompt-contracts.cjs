const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const scripts = __dirname;

function read(name) {
  return fs.readFileSync(path.join(scripts, name), "utf8");
}

test("author and reviewer preserve the source-authoritative Codex contract", () => {
  for (const name of ["codex-orchestrator-prompt.md", "review-refresh-prompt.md"]) {
    const prompt = read(name);
    assert.match(prompt, /exact tagged `references\/codex` source checkout is the complete,[\s\S]*authoritative capture/);
    assert.match(prompt, /no proxy trace or live model\s+request/);
    assert.match(prompt, /do not require/i);
    assert.match(prompt, /source-revisions\.json/);
    assert.match(prompt, /source-changes\.txt/);
    assert.match(prompt, /per-session code-mode listing/);
  }
});
