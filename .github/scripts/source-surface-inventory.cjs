#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [provider, sourceArg, oldRevision, newRevision, outputArg, ...searchRoots] = process.argv.slice(2);
if (!provider || !sourceArg || !oldRevision || !newRevision || !outputArg || searchRoots.length === 0) {
  console.error(
    "Usage: source-surface-inventory.cjs <provider> <source-checkout> <old-rev> <new-rev> <output> <search-root>...",
  );
  process.exit(2);
}

const sourceDir = path.resolve(sourceArg);
const outputPath = path.resolve(outputArg);
const sourceExtensions = new Set([
  ".c", ".cc", ".cpp", ".go", ".h", ".hpp", ".js", ".json", ".jsx",
  ".md", ".mjs", ".py", ".rs", ".toml", ".ts", ".tsx", ".yaml", ".yml",
]);

// These are surface types, not product paths or model names. The inventory
// stays useful when upstream moves or renames an implementation.
const roleSignals = new Map([
  ["prompt", /prompt|system.?instruction|developer.?message|personality/i],
  ["tool", /tool|function.?schema|json.?schema/i],
  ["agent", /agent|subagent|delegate|collab/i],
  ["skill", /skill|plugin|workflow/i],
  ["command", /command|slash/i],
  ["event", /event|reminder|notification|steering|message/i],
  ["mcp", /mcp|model.?context.?protocol/i],
  ["policy", /policy|permission|sandbox|guardian|approval/i],
  ["context", /context|memory|environment|workspace|compact/i],
  ["model", /model|reasoning|effort|variant/i],
  ["assembly", /assemble|builder|registry|catalog|render/i],
]);

function git(args, options = {}) {
  return childProcess.execFileSync(
    "git",
    ["-c", `safe.directory=${sourceDir}`, "-C", sourceDir, ...args],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, ...options },
  );
}

function revisionExists(revision) {
  try {
    git(["cat-file", "-e", `${revision}^{commit}`], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

for (const revision of [oldRevision, newRevision]) {
  if (!revisionExists(revision)) throw new Error(`Source revision is unavailable: ${revision}`);
}

function lines(value) {
  return value.split("\n").filter(Boolean);
}

function sourcePath(file) {
  return sourceExtensions.has(path.posix.extname(file).toLowerCase());
}

function grepExpression(signal) {
  return signal.source.replaceAll(".?", "[ _-]?");
}

function grepCandidates(revision) {
  const expression = [...roleSignals.values()]
    .map(grepExpression)
    .join("|");
  try {
    return lines(git(["grep", "-I", "-i", "-l", "-E", expression, revision, "--", ...searchRoots]))
      .map((entry) => entry.slice(entry.indexOf(":") + 1));
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

function treeEntries(revision) {
  const entries = new Map();
  const output = git(["ls-tree", "-r", "-z", revision, "--", ...searchRoots]);
  for (const record of output.split("\0").filter(Boolean)) {
    const match = record.match(/^[0-7]+\s+\w+\s+([0-9a-f]+)\t([\s\S]+)$/);
    if (match) entries.set(match[2], match[1]);
  }
  return entries;
}

function pathCandidates(tree) {
  return [...tree.keys()].filter((file) => {
    if (!sourcePath(file)) return false;
    const normalized = file.replaceAll("_", "-");
    return [...roleSignals.values()].some((signal) => signal.test(normalized));
  });
}

function roleIndex(revision) {
  const index = new Map();
  for (const [role, signal] of roleSignals) {
    let matches;
    try {
      matches = lines(git(["grep", "-I", "-i", "-l", "-E", grepExpression(signal), revision, "--", ...searchRoots]))
        .map((entry) => entry.slice(entry.indexOf(":") + 1));
    } catch (error) {
      if (error.status === 1) continue;
      throw error;
    }
    for (const file of matches) {
      if (!index.has(file)) index.set(file, new Set());
      index.get(file).add(role);
    }
  }
  return index;
}

function changedPaths() {
  const changed = new Map();
  for (const line of lines(git(["diff", "--name-status", "--find-renames", oldRevision, newRevision, "--", ...searchRoots]))) {
    const [status, first, second] = line.split("\t");
    if (!first) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      changed.set(first, { change: status[0] === "R" ? "removed" : "copied-from", counterpart: second });
      if (second) changed.set(second, { change: status[0] === "R" ? "added" : "copied", counterpart: first });
    } else {
      changed.set(first, {
        change: status === "A" ? "added" : status === "D" ? "removed" : "modified",
      });
    }
  }
  return changed;
}

function rolesFor(file, index) {
  const roles = new Set(index.get(file) || []);
  const normalized = file.replaceAll("_", "-");
  for (const [role, signal] of roleSignals) if (signal.test(normalized)) roles.add(role);
  return [...roles].sort();
}

const changed = changedPaths();
const newTree = treeEntries(newRevision);
const oldTree = treeEntries(oldRevision);
const newRoles = roleIndex(newRevision);
const oldRoles = roleIndex(oldRevision);
const currentSet = new Set([...grepCandidates(newRevision), ...pathCandidates(newTree)]);
const oldSet = new Set([...grepCandidates(oldRevision), ...pathCandidates(oldTree)]);

// Include every changed source file in the broad roots. A new surface can live
// in a generic file name and can use vocabulary that the classifier has not
// seen before.
for (const file of changed.keys()) {
  if (sourcePath(file) && changed.get(file).change !== "removed") currentSet.add(file);
}

const candidates = [...currentSet]
  .filter(sourcePath)
  .sort()
  .map((file) => {
    const change = changed.get(file);
    return {
      path: file,
      blob: newTree.get(file) || null,
      roles: rolesFor(file, newRoles),
      changed: Boolean(change),
      change: change?.change || "unchanged",
      ...(change?.counterpart ? { counterpart: change.counterpart } : {}),
    };
  });

const removedSet = new Set(oldSet);
for (const [file, change] of changed) {
  if (sourcePath(file) && change.change === "removed") removedSet.add(file);
}
const removed = [...removedSet]
  .filter((file) => changed.get(file)?.change === "removed")
  .sort()
  .map((file) => ({
    path: file,
    blob: oldTree.get(file) || null,
    roles: rolesFor(file, oldRoles),
    change: "removed",
    ...(changed.get(file)?.counterpart ? { counterpart: changed.get(file).counterpart } : {}),
  }));

const inventory = {
  schema_version: 1,
  provider,
  authority: "direct-source",
  old_revision: oldRevision,
  new_revision: newRevision,
  search_roots: searchRoots,
  classifier_roles: [...roleSignals.keys()],
  candidates,
  removed,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(
  `${provider} source surface inventory: ${candidates.length} current candidate(s), ` +
  `${candidates.filter((entry) => entry.changed).length} changed, ${removed.length} removed`,
);
