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
// derives distinctive fixed strings, finds the source files at the pinned revision
// that contain them, and records whether those files changed between the two
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
const maxProbesPerArtifact = 4;
const probeMinLength = 24;
const probeMaxLength = 160;

function git(args, options = {}) {
  return childProcess.execFileSync("git", ["-c", `safe.directory=${sourceDir}`, "-C", sourceDir, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

// Normalized artifacts carry `<harnessVariable>{{name=value}}</harnessVariable>`
// where the source interpolates a runtime value, so probes are cut from the text
// between those markers. A multi-line harness block can still wrap literal
// template markup of its own, so the per-line pass below keeps those lines as
// weaker candidates rather than discarding the whole block.
function literalRuns(text) {
  const betweenBlocks = text
    .split(/<harnessVariable>[\s\S]*?<\/harnessVariable>|\{\{[\s\S]*?\}\}/g)
    .flatMap((chunk) => chunk.split(/\r?\n/));
  const perLine = text
    .split(/\r?\n/)
    .map((line) => line.replace(/<\/?harnessVariable>/g, "").replace(/\{\{[^}]*\}\}/g, ""));
  return [...betweenBlocks, ...perLine];
}

// Source constants are usually named after the artifact, so the file stem is a
// usable last resort for a file that is almost entirely templating.
function stemProbes(stem) {
  return [...new Set([stem.replace(/-/g, "_"), stem])].filter((value) => value.length >= 8);
}

// A long line is still usable: take a slice of it rather than discarding the
// artifact. Leading and trailing XML-ish tags are dropped because the source
// often wraps an interpolated body in them.
function trimForProbe(line) {
  const stripped = line.trim().replace(/^<[A-Za-z_][A-Za-z0-9_-]*>/, "").replace(/<\/[A-Za-z_][A-Za-z0-9_-]*>$/, "").trim();
  return stripped.length > probeMaxLength ? stripped.slice(0, probeMaxLength).trimEnd() : stripped;
}

function textProbes(text, stem) {
  const seen = new Set();
  const probes = [];
  for (const run of literalRuns(text)) {
    const probe = trimForProbe(run);
    if (probe.length < probeMinLength || seen.has(probe)) continue;
    seen.add(probe);
    probes.push(probe);
  }
  // Longest first: a long sentence is far more distinctive than a short one.
  probes.sort((left, right) => right.length - left.length);
  for (const identifier of stem ? stemProbes(stem) : []) {
    if (!seen.has(identifier)) probes.push(identifier);
  }
  return probes;
}

// Tool schemas keep their distinctive prose in nested `description` and `note`
// fields, not only at the top level, so collect every string in the document.
function collectStrings(value, into) {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, into);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, into);
  return into;
}

function jsonProbes(text, stem) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return textProbes(text, stem);
  }
  const probes = textProbes(collectStrings(parsed, []).join("\n"));
  // A config-shaped schema such as web_search.json has no prose at all. Its
  // identifier is still a literal in the source, and quoting it keeps the match
  // off unrelated prefixes.
  const identifiers = [parsed?.name, parsed?.type, stem]
    .filter((value) => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_.-]{3,}$/.test(value))
    .map((value) => `"${value}"`);
  for (const identifier of identifiers) {
    if (!probes.includes(identifier)) probes.push(identifier);
  }
  return probes;
}

function search(probe) {
  try {
    const output = git([
      "grep", "--fixed-strings", "--files-with-matches", "-e", probe, newRevision, "--", ...searchRoots,
    ]);
    return output
      .split("\n")
      .filter(Boolean)
      // `git grep <rev>` prefixes every path with "<rev>:".
      .map((line) => line.slice(line.indexOf(":") + 1));
  } catch (error) {
    // git grep exits 1 when nothing matches, which is a normal answer here.
    if (error.status === 1) return [];
    throw error;
  }
}

let sourceTree = null;

// `git grep` only ever matches file content. Upstream templates are frequently
// named after the artifact they produce, so the tree listing is a separate and
// often decisive signal when no text probe survives.
function pathMatches(stem) {
  if (sourceTree === null) {
    sourceTree = git(["ls-tree", "-r", "--name-only", newRevision, "--", ...searchRoots])
      .split("\n")
      .filter(Boolean);
  }
  const wanted = new Set([stem, stem.replace(/-/g, "_"), stem.replace(/_/g, "-")]);
  return sourceTree.filter((file) => wanted.has(path.basename(file).replace(/\.[^.]+$/, "")));
}

// One probe can be shared by several sibling prompts, so a single search often
// returns a superset. Intersecting with the next probe narrows it whenever the
// two agree, and is skipped when they do not overlap at all.
function locate(probes, stem) {
  let paths = [];
  let used = null;
  for (const probe of probes.slice(0, maxProbesPerArtifact)) {
    const found = search(probe);
    if (found.length === 0) continue;
    if (paths.length === 0) {
      paths = found;
      used = probe;
      continue;
    }
    const intersection = paths.filter((candidate) => found.includes(candidate));
    if (intersection.length > 0 && intersection.length < paths.length) paths = intersection;
    if (paths.length === 1) break;
  }
  if (paths.length === 0) {
    paths = pathMatches(stem);
    if (paths.length > 0) used = `path:${stem}`;
  }
  return { paths: paths.slice(0, maxSourcePathsPerArtifact), probe: used, matchCount: paths.length };
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
      artifacts.push({ artifact: `${group}/${name}`, file, group, stem: name.replace(/\.[^.]+$/, "") });
    }
  }
  return artifacts;
}

const resolved = [];
const unresolved = [];

for (const entry of trackedArtifacts()) {
  const text = fs.readFileSync(entry.file, "utf8");
  const probes = entry.group === "tools" ? jsonProbes(text, entry.stem) : textProbes(text, entry.stem);
  const { paths, probe, matchCount } = locate(probes, entry.stem);
  if (paths.length === 0) {
    // A miss is real evidence: the artifact's text is gone from the new release,
    // so it needs an author decision rather than a silent carry-forward.
    unresolved.push({ artifact: entry.artifact, reason: "probe not found at the new revision" });
    continue;
  }
  resolved.push({
    artifact: entry.artifact,
    source_paths: paths,
    changed: changedBetweenRevisions(paths),
    // A wide match means the probe is shared by sibling artifacts; read the paths
    // as candidates rather than as a single definitive origin.
    match_confidence: matchCount === 1 ? "exact" : matchCount <= maxSourcePathsPerArtifact ? "narrow" : "wide",
    probe,
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
