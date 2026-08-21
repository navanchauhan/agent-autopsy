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
const miscLine = "You are performing a CONTEXT CHECKPOINT COMPACTION for another model.";
const toolDescription = "The apply_patch tool edits files as a FREEFORM patch payload.";

function git(cwd, args) {
  return childProcess.execFileSync("git", args, { cwd, encoding: "utf8" });
}

// A miniature stand-in for the upstream Codex tree: two revisions, one of which
// changes only the prompt source.
function buildSource() {
  const source = path.join(temp, "source");
  fs.mkdirSync(path.join(source, "codex-rs", "core", "src"), { recursive: true });
  git(source, ["init", "--quiet", "-b", "main"]);
  git(source, ["config", "user.email", "test@example.test"]);
  git(source, ["config", "user.name", "Test"]);

  const promptSource = path.join(source, "codex-rs", "core", "src", "prompt.rs");
  const toolSource = path.join(source, "codex-rs", "core", "src", "tools.rs");
  const miscSource = path.join(source, "codex-rs", "core", "src", "compact.rs");
  fs.writeFileSync(promptSource, `pub const DEFAULT: &str = "${promptLine}";\n`);
  fs.writeFileSync(toolSource, `pub const APPLY_PATCH_DESC: &str = "${toolDescription}";\n`);
  fs.writeFileSync(miscSource, `pub const COMPACT: &str = "${miscLine}";\n`);
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
  fs.mkdirSync(path.join(tracked, "prompts"), { recursive: true });
  fs.mkdirSync(path.join(tracked, "tools"), { recursive: true });
  fs.mkdirSync(path.join(tracked, "misc"), { recursive: true });
  fs.writeFileSync(path.join(tracked, "prompts", "default.md"), `${promptLine}\n`);
  fs.writeFileSync(path.join(tracked, "misc", "compact-prompt.md"), `${miscLine}\n`);
  fs.writeFileSync(
    path.join(tracked, "tools", "apply_patch.json"),
    `${JSON.stringify({ type: "custom", name: "apply_patch", description: toolDescription }, null, 2)}\n`,
  );
  // Text that no longer exists upstream must be reported, not silently carried.
  fs.writeFileSync(
    path.join(tracked, "prompts", "removed.md"),
    "This sentence was deleted from the upstream release and appears nowhere.\n",
  );
  return tracked;
}

const { source, oldRevision, newRevision } = buildSource();
const tracked = buildTracked();
const outputPath = path.join(temp, "artifact-source-map.json");
const result = childProcess.spawnSync(
  process.execPath,
  [mapper, source, oldRevision, newRevision, tracked, outputPath],
  { encoding: "utf8" },
);

test("the mapper succeeds and writes its index", () => {
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(outputPath));
});

const map = JSON.parse(fs.readFileSync(outputPath, "utf8"));
const byArtifact = new Map(map.artifacts.map((entry) => [entry.artifact, entry]));

test("each tracked artifact is bound to the source file that contains its text", () => {
  assert.deepEqual(byArtifact.get("prompts/default.md").source_paths, ["codex-rs/core/src/prompt.rs"]);
  assert.deepEqual(byArtifact.get("misc/compact-prompt.md").source_paths, ["codex-rs/core/src/compact.rs"]);
  assert.deepEqual(byArtifact.get("tools/apply_patch.json").source_paths, ["codex-rs/core/src/tools.rs"]);
});

test("the index separates artifacts whose source moved from those that did not", () => {
  // This is the signal the author was missing: which artifacts actually need work.
  assert.equal(byArtifact.get("prompts/default.md").changed, true);
  assert.equal(byArtifact.get("misc/compact-prompt.md").changed, false);
  assert.equal(byArtifact.get("tools/apply_patch.json").changed, false);
  assert.equal(map.changed_artifact_count, 1);
});

test("an artifact with no upstream match is reported as unresolved", () => {
  assert.deepEqual(
    map.unresolved.map((entry) => entry.artifact),
    ["prompts/removed.md"],
  );
  assert.match(map.unresolved[0].reason, /probe not found/);
  assert.ok(!byArtifact.has("prompts/removed.md"));
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
