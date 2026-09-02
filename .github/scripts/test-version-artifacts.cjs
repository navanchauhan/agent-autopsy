const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const updater = path.join(repoRoot, ".github", "scripts", "update-version-artifacts.cjs");

// The updater resolves paths from the repository root, so the fixture has to live
// inside it. `.capture-scratch` is git-ignored, and the fixture provider directory
// is created and removed per test.
const scratchRoot = path.join(repoRoot, ".capture-scratch");
const sha256 = "a".repeat(64);
const sha512 = "b".repeat(128);

function withFixture(provider, versionText, plan, run) {
  const providerDir = path.join(repoRoot, provider);
  const versionPath = path.join(providerDir, "VERSION");
  const existed = fs.existsSync(versionPath);
  const original = existed ? fs.readFileSync(versionPath, "utf8") : null;
  fs.mkdirSync(scratchRoot, { recursive: true });
  const planPath = path.join(scratchRoot, `version-artifacts-plan-${process.pid}.json`);
  fs.writeFileSync(planPath, JSON.stringify(plan));
  fs.mkdirSync(providerDir, { recursive: true });
  fs.writeFileSync(versionPath, versionText);
  try {
    const result = childProcess.spawnSync(process.execPath, [updater, provider], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, CHANGED_TOOLS_FILE: planPath },
    });
    run(result, fs.readFileSync(versionPath, "utf8"));
  } finally {
    fs.rmSync(planPath, { force: true });
    if (original === null) fs.rmSync(versionPath, { force: true });
    else fs.writeFileSync(versionPath, original);
  }
}

const grokPlan = (overrides = {}) => [{
  tool: "grok",
  dir: "grok",
  old_version: "0.2.118",
  new_version: "0.2.119",
  version_field: "version",
  artifact_sha256: sha256,
  ...overrides,
}];

test("an advanced provider gets the pinned digest even when the line was deleted", () => {
  // This is the exact 21 Aug failure: the author removed `sha256` from grok/VERSION
  // and every review attempt failed on the pinned-digest check.
  withFixture(
    "grok",
    "source = xai-org/grok-build\nversion = 0.2.119\nplatform = linux-x86_64\nprompts = 3\n",
    grokPlan(),
    (result, text) => {
      assert.equal(result.status, 0, result.stderr);
      assert.match(text, new RegExp(`^sha256 = ${sha256}$`, "m"));
      // The regenerated line follows `platform`, not the end of the file.
      assert.match(text, /platform = linux-x86_64\nsha256 = /);
    },
  );
});

test("an existing digest is replaced rather than duplicated", () => {
  withFixture(
    "grok",
    `source = xai-org/grok-build\nversion = 0.2.119\nplatform = linux-x86_64\nsha256 = ${"c".repeat(64)}\n`,
    grokPlan(),
    (result, text) => {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(text.match(/^sha256 = /gm).length, 1);
      assert.match(text, new RegExp(`^sha256 = ${sha256}$`, "m"));
    },
  );
});

test("Grok records the exact public mirror revision", () => {
  const mirror = "f".repeat(40);
  withFixture(
    "grok",
    `source = xai-org/grok-build\nversion = 0.2.119\nrevision = ${"e".repeat(40)}\nsha256 = ${sha256}\n`,
    grokPlan({ mirror_revision: mirror }),
    (result, text) => {
      assert.equal(result.status, 0, result.stderr);
      assert.match(text, new RegExp(`^mirror_revision = ${mirror}$`, "m"));
    },
  );
});

test("a provider held at the old release keeps its old digest", () => {
  // A held tool must never receive the digest of a release it did not capture.
  const heldDigest = "d".repeat(64);
  withFixture(
    "grok",
    `source = xai-org/grok-build\nversion = 0.2.118\nplatform = linux-x86_64\nsha256 = ${heldDigest}\n`,
    grokPlan(),
    (result, text) => {
      assert.equal(result.status, 0, result.stderr);
      assert.match(text, new RegExp(`^sha256 = ${heldDigest}$`, "m"));
      assert.match(result.stdout, /held at the previous release: grok/);
    },
  );
});

test("Antigravity manifest metadata is written from the plan", () => {
  const url = "https://example.test/antigravity-1.1.15-linux-x64.tar.gz";
  withFixture(
    "antigravity",
    [
      "source = antigravity.google/cli",
      "version = 1.1.15",
      "platform = linux-x64",
      "manifest_version = 1.1.14",
      "manifest_tarball_url = https://example.test/stale.tar.gz",
      `manifest_tarball_sha512 = ${"e".repeat(128)}`,
      "",
    ].join("\n"),
    [{
      tool: "antigravity",
      dir: "antigravity",
      old_version: "1.1.14",
      new_version: "1.1.15",
      version_field: "version",
      artifact_url: url,
      artifact_sha512: sha512,
    }],
    (result, text) => {
      assert.equal(result.status, 0, result.stderr);
      assert.match(text, /^manifest_version = 1\.1\.15$/m);
      assert.match(text, new RegExp(`^manifest_tarball_url = ${url.replace(/[.?*+^$[\]\\(){}|/-]/g, "\\$&")}$`, "m"));
      assert.match(text, new RegExp(`^manifest_tarball_sha512 = ${sha512}$`, "m"));
    },
  );
});

test("a source-derived provider with no pinned artifact is left alone", () => {
  withFixture(
    "codex",
    "source = openai/codex\nrevision = abc123\ncodex_cli_package_version = 0.148.0\n",
    [{
      tool: "codex",
      dir: "codex",
      old_version: "0.147.0",
      new_version: "0.148.0",
      version_field: "codex_cli_package_version",
    }],
    (result, text) => {
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(text, /^sha256 = /m);
    },
  );
});

test("an unknown provider name is refused", () => {
  const result = childProcess.spawnSync(process.execPath, [updater, "not-a-provider"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: update-version-artifacts\.cjs/);
});
