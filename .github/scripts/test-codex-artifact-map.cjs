const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("os");
const path = require("node:path");
const test = require("node:test");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const mapper = path.join(repoRoot, ".github", "scripts", "codex-artifact-map.cjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-autopsy-codex-map-"));

const promptLine = "You are a coding agent running in the Codex CLI, a terminal-based assistant.";
const sharedLine = "Communicate with the user by streaming thinking and responses as you work.";
const miscLine = "You are performing a CONTEXT CHECKPOINT COMPACTION for another model.";
const toolDescription = "The apply_patch tool edits files as a FREEFORM patch payload.";
const nestedDescription = "Generates and edits images from a natural language scene description.";
const sandboxLine = "Filesystem sandboxing defines which files can be read or written here.";
const longLine = `Delegation context follows and must be preserved verbatim by the harness. ${"x".repeat(220)}`;

function git(cwd, args) {
  return childProcess.execFileSync("git", args, { cwd, encoding: "utf8" });
}

// A miniature stand-in for the upstream Codex tree: two revisions, one of which
// changes only the prompt source.
function buildSource() {
  const source = path.join(temp, "source");
  const src = path.join(source, "codex-rs", "core", "src");
  fs.mkdirSync(src, { recursive: true });
  git(source, ["init", "--quiet", "-b", "main"]);
  git(source, ["config", "user.email", "test@example.test"]);
  git(source, ["config", "user.name", "Test"]);

  const promptSource = path.join(src, "prompt.rs");
  // Two files share `sharedLine`; only one also carries `promptLine`. The mapper
  // has to intersect the two probes to pick the right one.
  fs.writeFileSync(promptSource, `pub const DEFAULT: &str = "${promptLine}\\n${sharedLine}";\n`);
  fs.writeFileSync(path.join(src, "sibling.rs"), `pub const OTHER: &str = "${sharedLine}";\n`);
  fs.writeFileSync(path.join(src, "tools.rs"), `pub const DESC: &str = "${toolDescription}";\n`);
  fs.writeFileSync(path.join(src, "compact.rs"), `pub const COMPACT: &str = "${miscLine}";\n`);
  fs.writeFileSync(path.join(src, "imagegen.rs"), `pub const IMG: &str = "${nestedDescription}";\n`);
  fs.writeFileSync(
    path.join(src, "sandbox.rs"),
    `pub const RO: &str = "${sandboxLine} Network access is {networkAccess}.";\n`,
  );
  fs.writeFileSync(path.join(src, "delegation.rs"), `pub const D: &str = "${longLine.slice(0, 160)}";\n`);
  fs.writeFileSync(path.join(src, "web.rs"), `pub const KIND: &str = "web_search";\n`);
  fs.writeFileSync(path.join(src, "inter_agent_message.rs"), "pub const KIND: &str = \"envelope\";\n");
  git(source, ["add", "."]);
  git(source, ["commit", "--quiet", "-m", "old"]);
  const oldRevision = git(source, ["rev-parse", "HEAD"]).trim();

  fs.appendFileSync(promptSource, "// a later release edits only this file\n");
  git(source, ["add", "."]);
  git(source, ["commit", "--quiet", "-m", "new"]);
  const newRevision = git(source, ["rev-parse", "HEAD"]).trim();
  return { source, oldRevision, newRevision };
}

function buildTracked() {
  const tracked = path.join(temp, "tracked");
  for (const group of ["prompts", "tools", "misc"]) {
    fs.mkdirSync(path.join(tracked, group), { recursive: true });
  }
  fs.writeFileSync(path.join(tracked, "prompts", "default.md"), `${promptLine}\n${sharedLine}\n`);
  fs.writeFileSync(path.join(tracked, "misc", "compact-prompt.md"), `${miscLine}\n`);
  fs.writeFileSync(
    path.join(tracked, "tools", "apply_patch.json"),
    `${JSON.stringify({ type: "custom", name: "apply_patch", description: toolDescription }, null, 2)}\n`,
  );
  // Prose that lives only in a nested tool entry.
  fs.writeFileSync(
    path.join(tracked, "tools", "image_gen.json"),
    `${JSON.stringify({
      type: "namespace",
      name: "image_gen",
      description: "Tools in the namespace.",
      tools: [{ type: "function", name: "imagegen", description: nestedDescription }],
    }, null, 2)}\n`,
  );
  // A config-shaped schema with no prose at all: only its identifier is a literal.
  fs.writeFileSync(
    path.join(tracked, "tools", "web_search.json"),
    `${JSON.stringify({ type: "web_search", external_web_access: false }, null, 2)}\n`,
  );
  // The distinctive text sits before an interpolated harness variable.
  fs.writeFileSync(
    path.join(tracked, "misc", "permissions-sandbox-mode-read-only.md"),
    `${sandboxLine} Network access is <harnessVariable>{{networkAccess=restricted}}</harnessVariable>.\n`,
  );
  // A single line far longer than the probe ceiling.
  fs.writeFileSync(path.join(tracked, "misc", "long-single-line.md"), `${longLine}\n`);
  // Almost entirely templating, so only the file stem is left as a probe.
  fs.writeFileSync(
    path.join(tracked, "misc", "inter-agent-message.md"),
    "Sender: <harnessVariable>{{sender=/root}}</harnessVariable>\n",
  );
  return tracked;
}

const { source, oldRevision, newRevision } = buildSource();
const tracked = buildTracked();
const outputPath = path.join(temp, "artifact-source-map.json");
const result = childProcess.spawnSync(
  process.execPath,
  [mapper, source, oldRevision, newRevision, tracked, outputPath, "codex-rs"],
  { encoding: "utf8" },
);

test("the mapper succeeds and writes its index", () => {
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(outputPath));
});

const map = JSON.parse(fs.readFileSync(outputPath, "utf8"));
const byArtifact = new Map(map.artifacts.map((entry) => [entry.artifact, entry]));

test("every tracked artifact is located", () => {
  assert.deepEqual(map.unresolved, []);
  assert.equal(byArtifact.size, 8);
});

test("a shared probe is narrowed by intersecting the next probe", () => {
  // `sharedLine` alone matches prompt.rs and sibling.rs; only prompt.rs has both.
  assert.deepEqual(byArtifact.get("prompts/default.md").source_paths, ["codex-rs/core/src/prompt.rs"]);
  assert.equal(byArtifact.get("prompts/default.md").match_confidence, "exact");
});

test("the index separates artifacts whose source moved from those that did not", () => {
  // This is the signal the author was missing: which artifacts actually need work.
  assert.equal(byArtifact.get("prompts/default.md").changed, true);
  assert.equal(byArtifact.get("misc/compact-prompt.md").changed, false);
  assert.equal(byArtifact.get("tools/apply_patch.json").changed, false);
  assert.equal(map.changed_artifact_count, 1);
});

test("text before an interpolated harness variable is a usable probe", () => {
  const entry = byArtifact.get("misc/permissions-sandbox-mode-read-only.md");
  assert.deepEqual(entry.source_paths, ["codex-rs/core/src/sandbox.rs"]);
});

test("a line longer than the probe ceiling is sliced, not discarded", () => {
  const entry = byArtifact.get("misc/long-single-line.md");
  assert.deepEqual(entry.source_paths, ["codex-rs/core/src/delegation.rs"]);
  assert.ok(entry.probe.length <= 160);
});

test("a nested tool description is searched, not only the top-level one", () => {
  assert.deepEqual(byArtifact.get("tools/image_gen.json").source_paths, ["codex-rs/core/src/imagegen.rs"]);
});

test("a schema with no prose falls back to its quoted identifier", () => {
  const entry = byArtifact.get("tools/web_search.json");
  assert.deepEqual(entry.source_paths, ["codex-rs/core/src/web.rs"]);
  assert.equal(entry.probe, '"web_search"');
});

test("an all-template artifact falls back to a source file named after it", () => {
  // Nothing in this artifact survives as a text probe, and `git grep` cannot match
  // a filename, so the tree listing is the only remaining signal.
  const entry = byArtifact.get("misc/inter-agent-message.md");
  assert.deepEqual(entry.source_paths, ["codex-rs/core/src/inter_agent_message.rs"]);
  assert.equal(entry.probe, "path:inter-agent-message");
});

test("the recorded revisions are the pinned ones", () => {
  assert.equal(map.old_revision, oldRevision);
  assert.equal(map.new_revision, newRevision);
  assert.deepEqual(map.search_roots, ["codex-rs"]);
});

test("missing arguments are refused", () => {
  const refused = childProcess.spawnSync(process.execPath, [mapper, source], { encoding: "utf8" });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Usage: codex-artifact-map\.cjs/);
});

test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
