const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = path.join(__dirname, "source-surface-inventory.cjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "source-surface-inventory-"));
const source = path.join(temp, "source");
fs.mkdirSync(path.join(source, "src"), { recursive: true });

function git(args) {
  return childProcess.execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim();
}

git(["init", "-q", "-b", "main"]);
git(["config", "user.email", "test@example.invalid"]);
git(["config", "user.name", "Test"]);
fs.writeFileSync(path.join(source, "src", "existing.rs"), "const SYSTEM_PROMPT: &str = \"old\";\n");
fs.writeFileSync(path.join(source, "src", "unrelated.rs"), "pub fn value() -> u8 { 1 }\n");
fs.writeFileSync(path.join(source, "src", "opaque_removed.rs"), "pub fn vanished() -> u8 { 9 }\n");
git(["add", "."]);
git(["commit", "-qm", "old"]);
const oldRevision = git(["rev-parse", "HEAD"]);

fs.writeFileSync(path.join(source, "src", "existing.rs"), "const SYSTEM_PROMPT: &str = \"new\";\n");
fs.writeFileSync(path.join(source, "src", "opaque.rs"), "pub fn newly_added_surface() -> u8 { 2 }\n");
fs.writeFileSync(path.join(source, "src", "tool_registry.rs"), "const TOOL_SCHEMA: &str = \"schema\";\n");
fs.rmSync(path.join(source, "src", "opaque_removed.rs"));
git(["add", "."]);
git(["commit", "-qm", "new"]);
const newRevision = git(["rev-parse", "HEAD"]);

const output = path.join(temp, "inventory.json");
const result = childProcess.spawnSync(
  process.execPath,
  [script, "example", source, oldRevision, newRevision, output, "src"],
  { encoding: "utf8" },
);
const inventory = JSON.parse(fs.readFileSync(output, "utf8"));

test("source inventory is revision-pinned and semantic", () => {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(inventory.provider, "example");
  assert.equal(inventory.old_revision, oldRevision);
  assert.equal(inventory.new_revision, newRevision);
  assert.deepEqual(inventory.search_roots, ["src"]);
  assert.ok(inventory.candidates.find((entry) => entry.path === "src/existing.rs").roles.includes("prompt"));
  assert.ok(inventory.candidates.find((entry) => entry.path === "src/tool_registry.rs").roles.includes("tool"));
});

test("all changed source files are included even without known path or content words", () => {
  const opaque = inventory.candidates.find((entry) => entry.path === "src/opaque.rs");
  assert.ok(opaque);
  assert.equal(opaque.changed, true);
  assert.equal(opaque.change, "added");
  const removed = inventory.removed.find((entry) => entry.path === "src/opaque_removed.rs");
  assert.ok(removed);
  assert.equal(removed.change, "removed");
});

test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
