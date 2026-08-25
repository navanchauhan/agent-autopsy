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

test("the pinned release digest is written by a trusted step, not by a model", () => {
  // A digest that a model rewrites by hand is non-deterministic: the same prompt
  // wrote grok/VERSION sha256 correctly on one day and deleted the line on the
  // next, which failed every review attempt on the pinned-digest check.
  for (const name of ["codex-orchestrator-prompt.md", "codex-revise-prompt.md"]) {
    const prompt = read(name);
    assert.match(prompt, /Never add, edit, or\s+delete/);
    assert.match(prompt, /`VERSION` `sha256`/);
    assert.match(prompt, /trusted post-processing step\s+writes|trusted post-processing step writes/);
  }
  assert.match(
    read("codex-orchestrator-prompt.md"),
    /root `VERSION` `sha256`, `manifest_tarball_sha512`, `manifest_tarball_url`, and\s+`manifest_version` from the capture plan/,
  );
  assert.match(read("review-refresh-prompt.md"), /Treat that digest as\s+supported evidence/);

  const driver = read("run-codex-refresh.sh");
  const workflow = fs.readFileSync(path.join(scripts, "..", "workflows", "daily-refresh.yml"), "utf8");
  assert.match(driver, /update-version-counts\.cjs[\s\S]*update-version-artifacts\.cjs[\s\S]*update-surface-hashes\.cjs/);
  assert.match(workflow, /salvage_author_candidate\(\)[\s\S]*update-version-artifacts\.cjs/);
  // The trusted driver gate must stage the script it now depends on.
  assert.match(workflow, /update-version-counts\.cjs update-version-artifacts\.cjs/);
});

test("the reviewer can hold one stuck tool instead of failing the run", () => {
  const reviewer = read("review-refresh-prompt.md");
  assert.match(reviewer, /outcome `hold`/);
  assert.match(reviewer, /requires `capture_complete: true`/);
  assert.match(reviewer, /does not\s+request a new capture/);
  assert.match(reviewer, /Prefer `hold` over `reject`/);
  assert.match(reviewer, /return outcome `hold` for\s+Codex/);

  const schema = JSON.parse(read("review-result.schema.json"));
  assert.deepEqual(
    schema.$defs.toolResult.properties.outcome.enum,
    ["approve", "hold", "reject", "retry_capture"],
  );
  // The overall decision stays a three-way choice; `hold` is per tool only.
  assert.deepEqual(schema.properties.decision.enum, ["approve", "reject", "retry_capture"]);
});

test("Codex artifacts carry a per-artifact source index", () => {
  // Without this index the author has only a path list, cannot satisfy the
  // bounded execution order, and falls through to "report it blocked".
  for (const name of [
    "codex-orchestrator-prompt.md",
    "codex-revise-prompt.md",
    "review-refresh-prompt.md",
  ]) {
    assert.match(read(name), /artifact-source-map\.json/);
  }
  const author = read("codex-orchestrator-prompt.md");
  assert.match(author, /Open the\s+`source_paths` of every entry whose `changed` is true/);
  assert.match(author, /not a\s+prohibited\s+source\s+scan/);
  // A wide match is a lead, not an origin; the author has to be told the difference.
  assert.match(author, /`match_confidence`/);
  assert.match(author, /`exact`[\s\S]{0,120}`narrow`[\s\S]{0,120}`wide`/);
  assert.match(read("capture-tool.sh"), /codex-artifact-map\.cjs/);
});

test("the Antigravity CLI cannot self-update past the pinned release", () => {
  // The CLI replaces its own binary with whatever its auto-updater manifest
  // serves, so without this every target older than the manifest head fails the
  // extractor's pin assertion and can never be captured.
  const capture = read("capture-antigravity.sh");
  const dockerfile = fs.readFileSync(path.join(scripts, "..", "..", "Dockerfile"), "utf8");
  const workflow = fs.readFileSync(path.join(scripts, "..", "workflows", "daily-refresh.yml"), "utf8");
  assert.match(capture, /export AGY_CLI_DISABLE_AUTO_UPDATE=1/);
  assert.match(dockerfile, /capture-antigravity[\s\S]*?ENV AGY_CLI_DISABLE_AUTO_UPDATE=1/);
  // The env var alone is not sufficient: the CLI also spawns a background
  // updater, so the updater host has to be unreachable from the container.
  assert.match(workflow, /--add-host/);
  assert.match(workflow, /antigravity-cli-auto-updater-974169037036\.us-central1\.run\.app:127\.0\.0\.1/);
  assert.match(workflow, /capture_hosts\+=\(--add-host/);
  assert.match(workflow, /docker run[\s\S]{0,200}"\$\{capture_hosts\[@\]\}"/);
  // The pin is asserted before a capture is spent, not only by the extractor.
  assert.match(capture, /the plan pinned/);
  assert.match(capture, /--version/);
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

test("driver allows four bounded repair attempts", () => {
  const driver = read("run-codex-refresh.sh");
  const workflow = fs.readFileSync(path.join(scripts, "..", "workflows", "daily-refresh.yml"), "utf8");
  assert.match(driver, /for attempt in 1 2 3 4 5/);
  assert.match(driver, /CODEX_DRIVER_ATTEMPT must be 1, 2, 3, 4, or 5/);
  assert.match(workflow, /for attempt in 1 2 3 4 5/);
  assert.match(workflow, /trying deterministic candidate salvage/);
  assert.match(workflow, /salvage_author_candidate\(\)[\s\S]*update-version-counts\.cjs[\s\S]*update-surface-hashes\.cjs[\s\S]*generate-catalog\.cjs[\s\S]*validate-refresh\.cjs/);
  assert.match(read("codex-revise-prompt.md"), /Never bulk-advance Claude surface release fields/);
  assert.match(read("codex-revise-prompt.md"), /session-title surface[\s\S]*specific raw request/);
});

test("model timeouts return control to the bounded repair loop", () => {
  const driver = read("run-codex-refresh.sh");
  const validateRefresh = read("validate-refresh.cjs");
  const workflow = fs.readFileSync(path.join(scripts, "..", "workflows", "daily-refresh.yml"), "utf8");
  assert.doesNotMatch(driver, /timeout\s+--foreground/);
  assert.match(driver, /timeout --signal=TERM --kill-after=30s "\$author_timeout" codex exec/);
  assert.match(driver, /timeout --signal=TERM --kill-after=30s "\$review_timeout" codex exec/);
  assert.match(workflow, /CODEX_AUTHOR_TIMEOUT: 30m/);
  assert.match(workflow, /CODEX_REVIEW_TIMEOUT: 30m/);
  assert.match(workflow, /codex-driver:[\s\S]*?timeout-minutes: 300/);
  assert.match(workflow, /codex\/\*\|claude-code\/\*\|grok\/\*\|antigravity\/\*\|qwen-code\/\*\|CATALOG\.md/);
  assert.match(workflow, /git status --porcelain -- "\$\{tool_dirs\[@\]\}" CATALOG\.md/);
  assert.match(validateRefresh, /qwen-code must publish at least one source-derived prompts\/\*\.md artifact/);
  assert.match(validateRefresh, /qwen-code must publish source-derived tools\/\*\.json artifacts/);
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
