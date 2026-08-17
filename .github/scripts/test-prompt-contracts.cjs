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

test("author and reviewer treat Qwen Code as source-authoritative", () => {
  for (const name of ["codex-orchestrator-prompt.md", "review-refresh-prompt.md"]) {
    const prompt = read(name);
    assert.match(prompt, /exact tagged `references\/qwen-code`[\s\S]*complete,[\s\S]*authoritative capture/);
    assert.match(prompt, /no proxy trace/);
    assert.match(prompt, /direct-source-manifest\.json/);
  }
  assert.match(read("codex-revise-prompt.md"), /Qwen Code is source-authoritative/);
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

test("author and reviewer use bounded evidence inspection", () => {
  const author = read("codex-orchestrator-prompt.md");
  const reviewer = read("review-refresh-prompt.md");

  assert.match(author, /Required bounded execution order/);
  assert.match(author, /make the first tracked edits before doing optional\s+source research/);
  assert.match(author, /Never print, enumerate, or parse every raw\s+request/);
  assert.match(author, /Do not scan a whole Cargo\s+workspace/);
  assert.match(reviewer, /Use a bounded review sequence/);
  assert.match(reviewer, /Do not recursively scan source trees, enumerate all raw requests/);
});

test("driver allows three bounded repair attempts", () => {
  const driver = read("run-codex-refresh.sh");
  const workflow = fs.readFileSync(path.join(scripts, "..", "workflows", "daily-refresh.yml"), "utf8");
  assert.match(driver, /for attempt in 1 2 3 4/);
  assert.match(driver, /CODEX_DRIVER_ATTEMPT must be 1, 2, 3, or 4/);
  assert.match(workflow, /for attempt in 1 2 3 4/);
  assert.match(read("codex-revise-prompt.md"), /Never bulk-advance Claude surface release fields/);
  assert.match(read("codex-revise-prompt.md"), /session-title surface[\s\S]*specific raw request/);
});

test("model timeouts return control to the bounded repair loop", () => {
  const driver = read("run-codex-refresh.sh");
  const workflow = fs.readFileSync(path.join(scripts, "..", "workflows", "daily-refresh.yml"), "utf8");
  assert.doesNotMatch(driver, /timeout\s+--foreground/);
  assert.match(driver, /timeout --signal=TERM --kill-after=30s "\$author_timeout" codex exec/);
  assert.match(driver, /timeout --signal=TERM --kill-after=30s "\$review_timeout" codex exec/);
  assert.match(workflow, /CODEX_AUTHOR_TIMEOUT: 30m/);
  assert.match(workflow, /CODEX_REVIEW_TIMEOUT: 30m/);
  assert.match(workflow, /codex-driver:[\s\S]*?timeout-minutes: 300/);
  assert.match(workflow, /codex\/\*\|claude-code\/\*\|grok\/\*\|antigravity\/\*\|qwen-code\/\*\|CATALOG\.md/);
  assert.match(workflow, /git status --porcelain -- "\$\{tool_dirs\[@\]\}" CATALOG\.md/);
  assert.match(workflow, /author\) phase_timeout=32m/);
  assert.match(workflow, /review\) phase_timeout=32m/);
  assert.match(workflow, /timeout --signal=TERM --kill-after=30s "\$phase_timeout"[\s\S]*docker run/);
});

test("Codex runs unsandboxed inside the outer Docker boundary", () => {
  const driver = read("run-codex-refresh.sh");
  const invocations = driver.match(/--dangerously-bypass-approvals-and-sandbox/g) || [];
  assert.equal(invocations.length, 2);
  assert.doesNotMatch(driver, /default_permissions|approval_policy|codex sandbox|permissions\.author|permissions\.review/);
});

test("independent review uses a bounded final-only pass", () => {
  const reviewer = read("review-refresh-prompt.md");
  const workflow = fs.readFileSync(path.join(scripts, "..", "workflows", "daily-refresh.yml"), "utf8");
  assert.match(reviewer, /at most 12 targeted shell calls/);
  assert.match(reviewer, /Do not emit progress,[\s\S]*interim JSON/);
  assert.match(reviewer, /exactly one final[\s\S]*JSON object/);
  assert.match(workflow, /CODEX_REVIEW_MODEL: gpt-5\.6-sol/);
  assert.match(workflow, /CODEX_REVIEW_REASONING_EFFORT: low/);
});
