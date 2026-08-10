#!/usr/bin/env node

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { artifactDigest, validateManifest } = require("./surface-registry.cjs");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

test("all provider surface registries and the generated catalog validate", () => {
  childProcess.execFileSync(process.execPath, [path.join(__dirname, "validate-surfaces.cjs")], {
    cwd: repoRoot,
    stdio: "pipe",
  });
});

test("Claude embedded release cannot be mislabeled current", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "surface-registry-"));
  const provider = "claude-code";
  fs.mkdirSync(path.join(root, provider, "prompts"), { recursive: true });
  fs.writeFileSync(path.join(root, provider, "VERSION"), "version = 2.1.226\n");
  fs.writeFileSync(path.join(root, provider, "prompts", "prompt.md"), "<env>cc_version=2.1.221</env>\n");
  const surface = {
    id: "claude-code.prompt.agent.test",
    category: "agent prompt",
    models: ["test"], modes: ["non-interactive"], status: "current",
    capture_method: "model-request", captured_release: "2.1.226",
    verified_release: "2.1.226", dynamic_inputs: [], artifacts: ["prompts/prompt.md"],
  };
  surface.artifact_sha256 = artifactDigest(root, provider, surface.artifacts);
  fs.writeFileSync(path.join(root, provider, "SURFACES.json"), JSON.stringify({
    schema_version: 1, provider, observed_release: "2.1.226",
    privacy: {
      tracked_content: "derived-normalized-only", tracked_raw_requests: false,
      tracked_request_headers: false, tracked_user_messages: false,
      tracked_model_responses: false, tracked_machine_state: false,
      unknown_fields: "reject",
    },
    surfaces: [surface],
  }));
  const result = validateManifest(root, provider);
  assert.ok(result.errors.some((error) => error.includes("embedded cc_version 2.1.221")), result.errors.join("\n"));
});
