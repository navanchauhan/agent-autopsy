#!/usr/bin/env node

// Builds the per-artifact source index that the Codex capture was missing.
//
// The Codex capture used to hand the author two files: a `diff --shortstat` line
// and a grep-filtered list of changed source paths. Neither says which source file
// produces which tracked artifact, so the author could not satisfy the bounded
// execution order ("use specifically named constructors or snapshots for targeted
// source confirmation; do not scan a whole Cargo workspace") and fell through to
// its "report it blocked" branch on every wide release.
//
// This script does the locating deterministically. For each tracked artifact it
// takes a distinctive fixed string, finds the source files at the pinned revision
// that contain it, and records whether those files changed between the two
// revisions. The author then has an explicitly named, bounded read list.
//
// Usage: codex-artifact-map.cjs <source-checkout> <old-rev> <new-rev> <tracked-dir> <output>

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [sourceDir, oldRevision, newRevision, trackedDir, outputPath] = process.argv.slice(2);
if (!sourceDir || !oldRevision || !newRevision || !trackedDir || !outputPath) {
  throw new Error(
    "Usage: codex-artifact-map.cjs <source-checkout> <old-rev> <new-rev> <tracked-dir> <output>",
  );
}

// Search only the Rust workspace that assembles prompts and schemas. Everything
// else in the upstream tree is noise for this index.
const searchRoots = ["codex-rs"];
const maxSourcePathsPerArtifact = 6;
const probeMinLength = 24;
const probeMaxLength = 160;

function git(args, options = {}) {
  return childProcess.execFileSync("git", ["-c", `safe.directory=${sourceDir}`, "-C", sourceDir, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

// A probe has to survive being embedded in Rust source, so prefer a long single
// line with no leading markup and no placeholder syntax that the source templates.
function probeFrom(text) {
  const candidates = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line.length >= probeMinLength &&
      line.length <= probeMaxLength &&
      !line.includes("{") && !line.includes("}") &&
      !/^[-*#>|`]/.test(line))
    .sort((left, right) => right.length - left.length);
  return candidates[0] || null;
}

function jsonProbe(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return probeFrom(text);
  }
  const description = typeof parsed.description === "string" ? parsed.description : "";
  const fromDescription = probeFrom(description);
  if (fromDescription) return fromDescription;
  // A schema with no usable description still has a unique tool name.
  return typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : null;
}

function sourcePathsFor(probe) {
  try {
    const output = git([
      "grep", "--fixed-strings", "--files-with-matches", "-e", probe, newRevision, "--", ...searchRoots,
    ]);
    return output
      .split("\n")
      .filter(Boolean)
      // `git grep <rev>` prefixes every path with "<rev>:".
      .map((line) => line.slice(line.indexOf(":") + 1))
      .slice(0, maxSourcePathsPerArtifact);
  } catch (error) {
    // git grep exits 1 when nothing matches, which is a normal answer here.
    if (error.status === 1) return [];
    throw error;
  }
}

function changedBetweenRevisions(paths) {
  if (paths.length === 0) return null;
  try {
    git(["diff", "--quiet", oldRevision, newRevision, "--", ...paths], { stdio: "pipe" });
    return false;
  } catch (error) {
    if (error.status === 1) return true;
    throw error;
  }
}

function trackedArtifacts() {
  const groups = [
    ["prompts", (name) => name.endsWith(".md")],
    ["tools", (name) => name.endsWith(".json")],
    ["misc", (name) => /\.(?:md|txt|xml)$/.test(name)],
  ];
  const artifacts = [];
  for (const [group, predicate] of groups) {
    const directory = path.join(trackedDir, group);
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory).sort()) {
      if (!predicate(name)) continue;
      const file = path.join(directory, name);
      if (!fs.lstatSync(file).isFile()) continue;
      artifacts.push({ artifact: `${group}/${name}`, file, group });
    }
  }
  return artifacts;
}

const resolved = [];
const unresolved = [];

for (const entry of trackedArtifacts()) {
  const text = fs.readFileSync(entry.file, "utf8");
  const probe = entry.group === "tools" ? jsonProbe(text) : probeFrom(text);
  if (!probe) {
    unresolved.push({ artifact: entry.artifact, reason: "no distinctive probe string" });
    continue;
  }
  const sourcePaths = sourcePathsFor(probe);
  if (sourcePaths.length === 0) {
    // A miss is real evidence: the artifact's text is gone from the new release,
    // so it needs an author decision rather than a silent carry-forward.
    unresolved.push({ artifact: entry.artifact, reason: "probe not found at the new revision" });
    continue;
  }
  resolved.push({
    artifact: entry.artifact,
    source_paths: sourcePaths,
    changed: changedBetweenRevisions(sourcePaths),
  });
}

const map = {
  schema_version: 1,
  source: "openai/codex",
  old_revision: oldRevision,
  new_revision: newRevision,
  search_roots: searchRoots,
  artifacts: resolved,
  unresolved,
  changed_artifact_count: resolved.filter((entry) => entry.changed).length,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(map, null, 2)}\n`);
console.log(
  `codex artifact map: ${resolved.length} located ` +
  `(${map.changed_artifact_count} with changed source), ${unresolved.length} unresolved`,
);
