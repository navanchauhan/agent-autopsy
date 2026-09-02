#!/usr/bin/env node

// Writes the pinned artifact digests from the capture plan into each advanced
// provider's root VERSION file.
//
// These fields are not a judgement call. `artifact_sha256` and `artifact_sha512`
// are the digests the capture container already verified at download time
// (Dockerfile `sha256sum -c` / `sha512sum -c`), so the plan value is the only
// correct value. Leaving them to the author model made the field non-deterministic:
// the same prompt wrote the digest on one day and deleted the line on the next,
// which `validate-review.cjs` then rejected for every repair attempt.
//
// A tool that the author deliberately held at its old release is skipped, so a
// held directory never receives a digest belonging to a release it did not capture.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const allowed = new Set(["codex", "claude-code", "grok", "antigravity", "qwen-code"]);
const providers = process.argv.slice(2);
const changedPath = path.resolve(
  process.env.CHANGED_TOOLS_FILE || path.join(repoRoot, ".capture-scratch", "changed-tools.json"),
);

if (providers.length === 0 || providers.some((provider) => !allowed.has(provider))) {
  throw new Error(
    "Usage: update-version-artifacts.cjs <codex|claude-code|grok|antigravity|qwen-code> [...]",
  );
}

const plan = JSON.parse(fs.readFileSync(changedPath, "utf8"));
if (!Array.isArray(plan)) throw new Error("capture plan must be an array");

// Insert a missing field directly after the first anchor that is present, so a
// regenerated line lands where a reader expects it instead of at the end.
const anchors = ["platform", "revision", "version", "distribution", "source"];

function readFields(text) {
  const fields = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (match && !fields.has(match[1])) fields.set(match[1], match[2]);
  }
  return fields;
}

function setField(text, field, value) {
  const pattern = new RegExp(`^${field}\\s*=.*$`, "gm");
  if (pattern.test(text)) return text.replace(pattern, `${field} = ${value}`);
  const lines = text.split("\n");
  for (const anchor of anchors) {
    const index = lines.findIndex((line) => new RegExp(`^${anchor}\\s*=`).test(line));
    if (index >= 0) {
      lines.splice(index + 1, 0, `${field} = ${value}`);
      return lines.join("\n");
    }
  }
  return `${text.replace(/\n*$/, "")}\n${field} = ${value}\n`;
}

const updated = [];
const skipped = [];

for (const provider of providers) {
  const entry = plan.find((candidate) => candidate.dir === provider || candidate.tool === provider);
  if (!entry) continue;

  const versionPath = path.join(repoRoot, entry.dir || provider, "VERSION");
  if (!fs.existsSync(versionPath)) continue;
  let text = fs.readFileSync(versionPath, "utf8");
  const fields = readFields(text);

  // Only a directory the author actually advanced to the planned release may
  // carry that release's digests.
  const versionField = typeof entry.version_field === "string" ? entry.version_field : "version";
  if (fields.get(versionField) !== entry.new_version) {
    skipped.push(entry.tool);
    continue;
  }

  const before = text;
  if (typeof entry.artifact_sha256 === "string" && /^[0-9a-f]{64}$/.test(entry.artifact_sha256)) {
    text = setField(text, "sha256", entry.artifact_sha256);
  }
  if (typeof entry.artifact_sha512 === "string" && /^[0-9a-f]{128}$/.test(entry.artifact_sha512)) {
    text = setField(text, "manifest_tarball_sha512", entry.artifact_sha512);
    if (typeof entry.artifact_url === "string" && entry.artifact_url.length > 0) {
      text = setField(text, "manifest_tarball_url", entry.artifact_url);
    }
    text = setField(text, "manifest_version", entry.new_version);
  }
  if (provider === "grok" && typeof entry.mirror_revision === "string" && /^[0-9a-f]{40}$/.test(entry.mirror_revision)) {
    text = setField(text, "mirror_revision", entry.mirror_revision);
  }
  if (text === before) continue;

  fs.writeFileSync(versionPath, text);
  updated.push(entry.tool);
}

const parts = [`Updated VERSION artifact digests for: ${updated.join(", ") || "none"}`];
if (skipped.length > 0) parts.push(`held at the previous release: ${skipped.join(", ")}`);
console.log(parts.join("; "));
