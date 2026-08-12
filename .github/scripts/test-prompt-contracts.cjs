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

test("author and reviewer recognize the immutable Claude artifact attestation", () => {
  for (const name of ["codex-orchestrator-prompt.md", "review-refresh-prompt.md"]) {
    const prompt = read(name);
    assert.match(prompt, /`artifact-attestation\.json` is authoritative binary-identity evidence/);
    assert.match(prompt, /exact installed binary/);
    assert.match(prompt, /signed-manifest digest/);
    assert.match(prompt, /expected[\s\S]{0,30}observed\s+digest/);
    assert.match(prompt, /intentionally not\s+(?:copied into|exposed to)/);
  }
});

test("author, repair, and reviewer distinguish previews from normalized output", () => {
  for (const name of [
    "codex-orchestrator-prompt.md",
    "codex-revise-prompt.md",
    "review-refresh-prompt.md",
  ]) {
    const prompt = read(name);
    assert.match(prompt, /`evidence\/candidate\/`/);
    assert.match(prompt, /pre-author/i);
    assert.match(prompt, /not\s+(?:the\s+)?expected final working tree/i);
  }

  const reviewer = read("review-refresh-prompt.md");
  assert.match(reviewer, /Do not require its files or hashes to equal the tracked candidate/);
  assert.match(reviewer, /verify each final[\s\S]{0,80}directly against the raw request/);
  assert.match(reviewer, /preview hash equality is not required/);
});

test("privacy review allows non-PII model-facing context", () => {
  for (const name of [
    "codex-orchestrator-prompt.md",
    "codex-revise-prompt.md",
    "review-refresh-prompt.md",
  ]) {
    const prompt = read(name);
    assert.match(prompt, /actual PII/);
    assert.match(prompt, /synthetic[\s\S]{0,100}`\/Users\/example`/i);
    assert.match(prompt, /model-facing[\s\S]{0,120}(?:machine|OS)[\s\S]{0,160}(?:repository|Git)/i);
  }

  const reviewer = read("review-refresh-prompt.md");
  assert.match(reviewer, /do not use it to reject model-facing context/);
  assert.doesNotMatch(reviewer, /Remove or reject names, email addresses, account data, private\s+paths, repository identity/);
});
