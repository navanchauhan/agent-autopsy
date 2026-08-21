#!/usr/bin/env node

/*
 * Mechanical guardrail for an agent-produced refresh.
 *
 * Usage:
 *   node .github/scripts/validate-refresh.cjs [changed-tools.json] [summary.md]
 *
 * Defaults:
 *   changed-tools.json  $CHANGED_TOOLS_FILE or .capture-scratch/changed-tools.json
 *   summary.md          $CODEX_SUMMARY_FILE or .capture-scratch/codex-summary.md
 *   git baseline        $REFRESH_BASE_REF, $VALIDATE_BASE_REF, or HEAD
 */

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = childProcess
  .execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" })
  .trim();
const scratchDir = process.env.CAPTURE_SCRATCH_DIR || path.join(repoRoot, ".capture-scratch");
const changedToolsPath = path.resolve(
  process.argv[2] || process.env.CHANGED_TOOLS_FILE || path.join(scratchDir, "changed-tools.json"),
);
const summaryPath = path.resolve(
  process.argv[3] || process.env.CODEX_SUMMARY_FILE || path.join(scratchDir, "codex-summary.md"),
);
const baseRef = process.env.REFRESH_BASE_REF || process.env.VALIDATE_BASE_REF || "HEAD";

const errors = [];

function fail(message) {
  errors.push(message);
}

function readText(filePath, label) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    fail(`${label}: cannot read ${displayPath(filePath)} (${error.message})`);
    return null;
  }
}

function displayPath(filePath) {
  const relative = path.relative(repoRoot, filePath);
  return relative && !relative.startsWith("..") ? relative : filePath;
}

function parseJsonFile(filePath, label) {
  const text = readText(filePath, label);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label}: invalid JSON in ${displayPath(filePath)} (${error.message})`);
    return null;
  }
}

function validateChangedTools(value) {
  if (!Array.isArray(value)) {
    fail("changed tools: top-level value must be an array");
    return [];
  }

  const seenTools = new Set();
  const seenDirs = new Set();
  const valid = [];

  value.forEach((entry, index) => {
    const label = `changed tools entry ${index}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`${label}: must be an object`);
      return;
    }

    let entryValid = true;
    for (const field of ["tool", "dir", "old_version", "new_version"]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        fail(`${label}: ${field} must be a non-empty string`);
        entryValid = false;
      }
    }
    if (
      typeof entry.tool !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.tool)
    ) {
      fail(`${label}: tool must use only letters, numbers, dot, underscore, or hyphen`);
      entryValid = false;
    }
    if (
      typeof entry.dir !== "string" ||
      entry.dir !== path.basename(entry.dir) ||
      entry.dir === "." ||
      entry.dir === ".."
    ) {
      fail(`${label}: dir must be a single repository-root directory name`);
      entryValid = false;
    }
    if (
      typeof entry.old_version === "string" &&
      typeof entry.new_version === "string" &&
      entry.old_version === entry.new_version
    ) {
      fail(`${label}: old_version and new_version must differ`);
      entryValid = false;
    }
    if (typeof entry.tool === "string" && seenTools.has(entry.tool)) {
      fail(`${label}: duplicate tool ${JSON.stringify(entry.tool)}`);
      entryValid = false;
    }
    if (typeof entry.dir === "string" && seenDirs.has(entry.dir)) {
      fail(`${label}: duplicate dir ${JSON.stringify(entry.dir)}`);
      entryValid = false;
    }
    if (typeof entry.tool === "string") seenTools.add(entry.tool);
    if (typeof entry.dir === "string") seenDirs.add(entry.dir);

    if (
      typeof entry.dir === "string" &&
      entry.dir === path.basename(entry.dir) &&
      entry.dir !== "." &&
      entry.dir !== ".."
    ) {
      const dirPath = path.join(repoRoot, entry.dir);
      try {
        const stat = fs.lstatSync(dirPath);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          fail(`${label}: ${displayPath(dirPath)} must be a real directory`);
          entryValid = false;
        }
        if (!fs.existsSync(path.join(dirPath, "VERSION"))) {
          fail(`${label}: ${entry.dir}/VERSION does not exist`);
          entryValid = false;
        }
      } catch (error) {
        fail(`${label}: cannot inspect ${displayPath(dirPath)} (${error.message})`);
        entryValid = false;
      }
    }

    if (entryValid) valid.push(entry);
  });

  return valid;
}

function validateSummary(tools) {
  const summary = readText(summaryPath, "summary");
  if (summary === null) return;

  const headings = summary
    .split(/\r?\n/)
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3));
  const expected = tools.map((entry) => entry.tool);

  const firstHeadingOffset = summary.search(/^## /m);
  if (
    expected.length > 0 &&
    firstHeadingOffset > 0 &&
    summary.slice(0, firstHeadingOffset).trim()
  ) {
    fail("summary: content before the first tool heading is not allowed");
  }

  if (headings.length !== expected.length) {
    fail(`summary: expected ${expected.length} level-two tool heading(s), found ${headings.length}`);
  }
  const count = Math.max(headings.length, expected.length);
  for (let index = 0; index < count; index += 1) {
    if (headings[index] !== expected[index]) {
      fail(
        `summary: heading ${index + 1} must be ${JSON.stringify(expected[index])}, found ${JSON.stringify(headings[index])}`,
      );
    }
  }

  const sections = summary.split(/^## .+$/m).slice(1);
  sections.forEach((section, index) => {
    if (section.trim() === "") {
      fail(`summary: section for ${expected[index] || `heading ${index + 1}`} is empty`);
    }
  });
}

function gitPaths(args, label) {
  try {
    const output = childProcess.execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return output
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString("utf8").trim() : error.message;
    fail(`${label}: git command failed (${stderr})`);
    return [];
  }
}

function collectModifiedPaths() {
  const tracked = gitPaths(
    ["diff", "--name-only", "--no-renames", "--diff-filter=ACDMRTUXB", "-z", baseRef, "--"],
    `modified paths against ${baseRef}`,
  );
  const untracked = gitPaths(
    ["ls-files", "--others", "--exclude-standard", "-z"],
    "untracked paths",
  );
  return [...new Set([...tracked, ...untracked])].sort();
}

function isInsideAllowedDir(relativePath, allowedDirs) {
  return allowedDirs.some((dir) => relativePath === dir || relativePath.startsWith(`${dir}/`));
}

function isNormalizedArtifactPath(relativePath, owner) {
  if (!relativePath.startsWith(`${owner}/`)) return false;
  const local = relativePath.slice(owner.length + 1);
  if (local === "VERSION") return true;
  if (local === "SURFACES.json") return true;
  if (/^prompts\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(local)) return true;
  if (/^tools\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(local)) return true;
  return /^misc\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:json|md|txt|xml|VERSION)$/.test(local);
}

function validateModificationScope(modifiedPaths, tools) {
  const allowedDirs = tools.map((entry) => entry.dir);
  for (const relativePath of modifiedPaths) {
    if (relativePath === "CATALOG.md") continue;
    if (!isInsideAllowedDir(relativePath, allowedDirs)) {
      fail(`scope: ${relativePath} is modified but is outside changed tool directories`);
    }
    const owner = allowedDirs.find((dir) => relativePath.startsWith(`${dir}/`));
    if (!owner || !isNormalizedArtifactPath(relativePath, owner)) {
      fail(`scope: ${relativePath} is not an allowlisted normalized artifact path`);
    }
  }
}

function candidatePaths(tools) {
  const pathspecs = tools.map((entry) => entry.dir);
  if (pathspecs.length === 0) return [];
  const tracked = gitPaths(["ls-files", "-z", "--", ...pathspecs], "candidate tracked paths");
  const untracked = gitPaths(
    ["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspecs],
    "candidate untracked paths",
  );
  return [...new Set([...tracked, ...untracked])].sort();
}

function isRawCapturePath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const base = path.posix.basename(normalized).toLowerCase();
  return (
    normalized.includes("/artifacts/trace/") ||
    /\.(jsonl|har|pcap|pcapng)$/.test(base) ||
    /^(agy|capture|grok-capture|claude-trace|amp-trace)\.(log|json|jsonl)$/.test(base) ||
    /(?:^|[-_.])(capture|trace)(?:[-_.][^.]+)*\.(log|json|jsonl)$/.test(base)
  );
}

function validateCandidatePaths(paths) {
  for (const relativePath of paths) {
    const absolutePath = path.join(repoRoot, relativePath);
    let stat;
    try {
      stat = fs.lstatSync(absolutePath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      fail(`files: cannot inspect ${relativePath} (${error.message})`);
      continue;
    }
    if (stat.isSymbolicLink()) fail(`files: symbolic links are not allowed (${relativePath})`);
    if (stat.isFile() && (stat.mode & 0o111) !== 0) {
      fail(`files: executable candidate is not allowed (${relativePath})`);
    }
    if (stat.isFile() && isRawCapturePath(relativePath)) {
      fail(`files: raw capture artifact is not allowed (${relativePath})`);
    }
  }
}

const secretPatterns = [
  ["private key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["OpenAI-style API key", /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ["Google OAuth token", /\bya29\.[A-Za-z0-9_-]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["authorization header", /\b(?:authorization|proxy-authorization)\s*[:=]\s*["']?(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{20,}/i],
  ["credential JSON value", /["'](?:access_token|refresh_token|id_token|api_key|client_secret)["']\s*:\s*["'](?!\*{3}|<|example)[^"']{12,}["']/i],
];

function validateChangedFileContents(modifiedPaths) {
  for (const relativePath of modifiedPaths) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;

    const buffer = fs.readFileSync(absolutePath);
    if (buffer.includes(0)) {
      fail(`files: binary or NUL-bearing candidate is not allowed (${relativePath})`);
      continue;
    }
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch (error) {
      fail(`files: candidate is not valid UTF-8 (${relativePath}: ${error.message})`);
      continue;
    }
    for (const [label, pattern] of secretPatterns) {
      if (pattern.test(text)) fail(`secrets: possible ${label} in ${relativePath}`);
    }

    if (relativePath.endsWith(".json")) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        fail(`JSON: invalid ${relativePath} (${error.message})`);
        continue;
      }
      const provenancePaths = [];
      findForbiddenProvenance(parsed, "$", provenancePaths);
      for (const provenancePath of provenancePaths) {
        fail(`JSON: ${relativePath} contains committed run provenance at ${provenancePath}`);
      }
    }
  }
}

function findForbiddenProvenance(value, jsonPath, found) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenProvenance(item, `${jsonPath}[${index}]`, found));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${jsonPath}.${key}`;
    if (key === "trace_files" || key === "trace_lines") found.push(childPath);
    findForbiddenProvenance(child, childPath, found);
  }
}

function parseVersion(filePath) {
  const text = readText(filePath, "VERSION");
  const fields = new Map();
  if (text === null) return fields;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (match && !fields.has(match[1])) fields.set(match[1], match[2]);
  }
  return fields;
}

function leadingInteger(value) {
  if (value === undefined) return null;
  const match = value.match(/^\s*(\d+)(?:\s|$)/);
  return match ? Number(match[1]) : null;
}

function listedFiles(value) {
  if (value === undefined) return null;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .sort();
}

function immediateFiles(dirPath, predicate = () => true) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateCount(label, declaredValue, actual, versionPath) {
  if (declaredValue === undefined) return;
  const declared = leadingInteger(declaredValue);
  if (declared === null) {
    fail(`VERSION: ${displayPath(versionPath)} field ${label} does not start with an integer`);
  } else if (declared !== actual) {
    fail(`VERSION: ${displayPath(versionPath)} says ${label}=${declared}, found ${actual}`);
  }
}

function validateVersionMetadata(tool, versionPath) {
  const fields = parseVersion(versionPath);
  for (const field of ["generated_at", "trace_source", "trace_path", "trace_file", "trace_lines"]) {
    if (fields.has(field)) {
      fail(`VERSION: ${displayPath(versionPath)} contains transport-only field ${field}`);
    }
  }
  if (tool.tool === "antigravity") {
    for (const field of ["sha256", "sha512"]) {
      if (fields.has(field)) {
        fail(`VERSION: ${displayPath(versionPath)} contains unsupported executable digest field ${field}; use signed manifest_tarball_sha512 evidence`);
      }
    }
  }
}

function validateVersionInventory(tool) {
  const dirPath = path.join(repoRoot, tool.dir);
  const versionPath = path.join(dirPath, "VERSION");
  const fields = parseVersion(versionPath);
  validateVersionMetadata(tool, versionPath);

  const allPrompts = immediateFiles(path.join(dirPath, "prompts"), (name) => name.endsWith(".md"));
  const declaredPromptFiles = listedFiles(fields.get("prompt_files"));
  let countedPrompts = allPrompts;
  if (declaredPromptFiles) {
    if (!sameList(declaredPromptFiles, allPrompts)) {
      fail(`VERSION: ${tool.dir}/prompt_files does not match prompts/*.md`);
    }
    countedPrompts = declaredPromptFiles;
  } else if (fields.get("capture_mode") === "non-interactive") {
    countedPrompts = allPrompts.filter((name) => !name.endsWith("-interactive.md"));
  } else if (fields.get("capture_mode") === "interactive") {
    countedPrompts = allPrompts.filter((name) => name.endsWith("-interactive.md"));
  }
  validateCount("prompts", fields.get("prompts"), countedPrompts.length, versionPath);

  const toolFiles = immediateFiles(path.join(dirPath, "tools"), (name) => name.endsWith(".json"));
  const declaredToolFiles = listedFiles(fields.get("tool_files"));
  if (declaredToolFiles && !sameList(declaredToolFiles, toolFiles)) {
    fail(`VERSION: ${tool.dir}/tool_files does not match tools/*.json`);
  }
  validateCount("tools", fields.get("tools"), toolFiles.length, versionPath);

  if (tool.tool === "codex") {
    // An unresolved map entry means the artifact's exact text no longer appears
    // upstream, which is the strongest available signal that it drifted. The
    // 0.149.0 refresh advanced the release while leaving one such artifact at its
    // 0.148.0 wording, so an advance now has to touch every unresolved artifact
    // or leave the release where it was.
    const mapPath = path.join(scratchDir, "codex", "evidence", "artifact-source-map.json");
    const sourceMap = fs.existsSync(mapPath) ? parseJsonFile(mapPath, "Codex artifact source map") : null;
    const advanced = fields.get(tool.version_field || "codex_cli_package_version") === tool.new_version;
    for (const entry of (advanced && sourceMap?.unresolved) || []) {
      const artifactPath = path.join(dirPath, entry.artifact);
      const changed = childProcess
        .execFileSync("git", ["status", "--porcelain", "--", path.relative(repoRoot, artifactPath)], {
          cwd: repoRoot,
          encoding: "utf8",
        })
        .trim() !== "";
      if (!changed) {
        fail(
          `codex/${entry.artifact}: the artifact source map could not find this text at ${tool.new_version} ` +
          "(" + entry.reason + "), so it must be re-derived from the source checkout or the release must not advance",
        );
      }
    }
  }

  if (tool.tool === "qwen-code") {
    if (allPrompts.length === 0) {
      fail("VERSION: qwen-code must publish at least one source-derived prompts/*.md artifact");
    }
    if (toolFiles.length === 0) {
      fail("VERSION: qwen-code must publish source-derived tools/*.json artifacts");
    }
    const manifest = parseJsonFile(path.join(dirPath, "SURFACES.json"), "Qwen surface registry");
    for (const surface of manifest?.surfaces || []) {
      if (surface.status === "gap") {
        fail(`Qwen surface registry: ${surface.id} must be resolved from the authoritative source checkout`);
      }
      if (surface.status === "captured" && (!Array.isArray(surface.artifacts) || surface.artifacts.length === 0)) {
        fail(`Qwen surface registry: ${surface.id} must name its extracted artifacts`);
      }
    }
  }

  if (tool.tool === "grok") {
    const promptModels = listedFiles(fields.get("prompt_models"));
    if (!promptModels || promptModels.length !== 1) {
      fail(`VERSION: ${tool.dir}/prompt_models must name exactly one captured Grok model`);
    } else {
      const modelField = `${promptModels[0].replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase()}_tools`;
      const modelToolFields = [...fields.keys()].filter(
        (name) => /^grok_[A-Za-z0-9_]+_tools$/.test(name) && name !== "grok_session_title_tools",
      );
      if (!fields.has(modelField)) {
        fail(`VERSION: ${tool.dir}/VERSION must use ${modelField} for prompt_models=${promptModels[0]}`);
      }
      for (const staleField of modelToolFields) {
        if (staleField !== modelField) {
          fail(`VERSION: ${tool.dir}/VERSION retains stale model tool field ${staleField}; expected ${modelField}`);
        }
      }
      const sessionTitleTools = leadingInteger(fields.get("grok_session_title_tools")) || 0;
      validateCount(modelField, fields.get(modelField), toolFiles.length - sessionTitleTools, versionPath);
    }
  }

  const miscFiles = immediateFiles(path.join(dirPath, "misc"));
  for (const miscVersion of miscFiles.filter((name) => name.endsWith(".VERSION"))) {
    validateVersionMetadata(tool, path.join(dirPath, "misc", miscVersion));
  }
  const miscArtifacts = miscFiles.filter((name) => !name.endsWith(".VERSION"));
  const declaredMiscFiles = listedFiles(fields.get("misc_files"));
  if (declaredMiscFiles) {
    if (!sameList(declaredMiscFiles, miscArtifacts)) {
      fail(`VERSION: ${tool.dir}/misc_files does not match misc artifacts`);
    }
  }
  validateCount(
    "misc",
    fields.get("misc"),
    miscArtifacts.length,
    versionPath,
  );
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      "Usage: node .github/scripts/validate-refresh.cjs [changed-tools.json] [summary.md]\n" +
        "Environment: REFRESH_BASE_REF or VALIDATE_BASE_REF selects the git baseline (default HEAD).",
    );
    return;
  }

  const changedTools = validateChangedTools(parseJsonFile(changedToolsPath, "changed tools"));
  validateSummary(changedTools);

  const modifiedPaths = collectModifiedPaths();
  validateModificationScope(modifiedPaths, changedTools);
  validateCandidatePaths(candidatePaths(changedTools));
  const allowedDirs = changedTools.map((tool) => tool.dir);
  validateChangedFileContents(
    modifiedPaths.filter((file) => file === "CATALOG.md" || isInsideAllowedDir(file, allowedDirs)),
  );
  changedTools.forEach(validateVersionInventory);
  if (allowedDirs.every((dir) => fs.existsSync(path.join(repoRoot, dir, "SURFACES.json")))) {
    try {
      childProcess.execFileSync("node", [
        path.join(__dirname, "validate-surfaces.cjs"),
        ...allowedDirs,
        `--base-ref=${baseRef}`,
      ], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      childProcess.execFileSync("node", [path.join(__dirname, "generate-catalog.cjs"), "--check"], {
        cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      fail(`surfaces: ${(error.stderr || error.stdout || error.message).toString().trim()}`);
    }
  }

  if (errors.length > 0) {
    console.error(`Refresh validation failed with ${errors.length} error(s):`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    `Refresh validation passed for ${changedTools.length} tool(s): ${changedTools.map((entry) => entry.tool).join(", ") || "none"}`,
  );
}

main();
