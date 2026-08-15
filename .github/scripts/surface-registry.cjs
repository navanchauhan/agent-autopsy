#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const providerReleaseFields = new Map([
  ["ampcode", "version"],
  ["antigravity", "version"],
  ["claude-code", "version"],
  ["codex", "codex_cli_package_version"],
  ["grok", "version"],
]);

const statuses = new Set(["current", "verified-unchanged", "stale", "frozen", "gap", "dynamic"]);
const captureMethods = new Set([
  "direct-source",
  "model-request",
  "local-inspection",
  "source-and-model-request",
  "unavailable",
]);
const artifactExtensions = new Set([".json", ".md", ".txt", ".xml"]);
const forbiddenArtifactNames = [
  /(?:^|\/)raw(?:\/|$)/i,
  /(?:^|\/)trace(?:s)?(?:\/|$)/i,
  /capture.*\.jsonl$/i,
  /(?:request|response)[-_]body.*\.(?:json|jsonl)$/i,
  /header.*\.(?:json|jsonl)$/i,
];
const forbiddenManifestPatterns = [
  ["private key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["authorization value", /\b(?:authorization|proxy-authorization)\s*[:=]\s*["']?(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{12,}/i],
  ["token-shaped value", /\b(?:gh[pousr]_|sk-ant-|sk-(?:proj-|svcacct-)?|ya29\.)[A-Za-z0-9._-]{12,}\b/],
];

function parseVersionFile(filePath) {
  const fields = new Map();
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (match && !fields.has(match[1])) fields.set(match[1], match[2]);
  }
  return fields;
}

function readManifest(repoRoot, provider) {
  const manifestPath = path.join(repoRoot, provider, "SURFACES.json");
  const text = fs.readFileSync(manifestPath, "utf8");
  for (const [label, pattern] of forbiddenManifestPatterns) {
    if (pattern.test(text)) throw new Error(`${provider}/SURFACES.json contains a possible ${label}`);
  }
  return { manifestPath, text, manifest: JSON.parse(text) };
}

function artifactDigest(repoRoot, provider, artifacts) {
  const hash = crypto.createHash("sha256");
  for (const relative of [...artifacts].sort()) {
    const absolute = path.join(repoRoot, provider, relative);
    hash.update(relative, "utf8");
    hash.update("\0");
    hash.update(fs.readFileSync(absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function trackedArtifacts(repoRoot, provider) {
  const files = [];
  for (const directory of ["prompts", "tools", "misc"]) {
    const absoluteDirectory = path.join(repoRoot, provider, directory);
    if (!fs.existsSync(absoluteDirectory)) continue;
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      if (directory === "misc" && entry.name.endsWith(".VERSION")) continue;
      if (!artifactExtensions.has(path.extname(entry.name).toLowerCase())) continue;
      files.push(`${directory}/${entry.name}`);
    }
  }
  return files.sort();
}

function isSafeArtifactPath(relative) {
  if (typeof relative !== "string" || relative === "" || relative.includes("\\")) return false;
  if (path.posix.isAbsolute(relative) || path.posix.normalize(relative) !== relative) return false;
  if (relative.split("/").some((segment) => segment === ".." || segment === "")) return false;
  if (!/^(?:prompts|tools|misc)\//.test(relative)) return false;
  if (forbiddenArtifactNames.some((pattern) => pattern.test(relative))) return false;
  return artifactExtensions.has(path.posix.extname(relative).toLowerCase());
}

function expectString(value, label, errors) {
  if (typeof value !== "string" || value.trim() === "") errors.push(`${label} must be a nonempty string`);
}

function expectStringArray(value, label, errors) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    errors.push(`${label} must be an array of nonempty strings`);
  }
}

function validatePrivacy(provider, privacy, errors) {
  const expected = {
    tracked_content: "derived-normalized-only",
    tracked_raw_requests: false,
    tracked_request_headers: false,
    tracked_user_messages: false,
    tracked_model_responses: false,
    tracked_machine_state: true,
    unknown_fields: "reject",
  };
  if (!privacy || typeof privacy !== "object" || Array.isArray(privacy)) {
    errors.push(`${provider}: privacy must be an object`);
    return;
  }
  const keys = Object.keys(privacy).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    errors.push(`${provider}: privacy must contain exactly ${expectedKeys.join(", ")}`);
    return;
  }
  for (const [key, value] of Object.entries(expected)) {
    if (privacy[key] !== value) errors.push(`${provider}: privacy.${key} must be ${JSON.stringify(value)}`);
  }
}

function validateManifest(repoRoot, provider, options = {}) {
  const errors = [];
  const releaseField = providerReleaseFields.get(provider);
  if (!releaseField) return { errors: [`unknown provider: ${provider}`] };

  let manifestPath;
  let manifest;
  try {
    ({ manifestPath, manifest } = readManifest(repoRoot, provider));
  } catch (error) {
    return { errors: [error.message] };
  }

  if (manifest.schema_version !== 1) errors.push(`${provider}: schema_version must be 1`);
  if (manifest.provider !== provider) errors.push(`${provider}: provider must equal ${provider}`);
  expectString(manifest.observed_release, `${provider}: observed_release`, errors);
  validatePrivacy(provider, manifest.privacy, errors);
  if (!Array.isArray(manifest.surfaces) || manifest.surfaces.length === 0) {
    errors.push(`${provider}: surfaces must be a nonempty array`);
  }

  try {
    const versionFields = parseVersionFile(path.join(repoRoot, provider, "VERSION"));
    const recordedRelease = versionFields.get(releaseField);
    if (recordedRelease !== manifest.observed_release) {
      errors.push(`${provider}: observed_release ${JSON.stringify(manifest.observed_release)} does not match VERSION ${releaseField}=${JSON.stringify(recordedRelease)}`);
    }
  } catch (error) {
    errors.push(`${provider}: cannot read VERSION (${error.message})`);
  }

  const ids = new Set();
  const claimed = new Map();
  for (const [index, surface] of (manifest.surfaces || []).entries()) {
    const label = `${provider}: surface ${index + 1}`;
    if (!surface || typeof surface !== "object" || Array.isArray(surface)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    expectString(surface.id, `${label}.id`, errors);
    if (typeof surface.id === "string") {
      if (!surface.id.startsWith(`${provider}.`) || !/^[a-z0-9][a-z0-9.-]*$/.test(surface.id)) {
        errors.push(`${label}.id must be a lowercase ${provider} identifier`);
      }
      if (ids.has(surface.id)) errors.push(`${label}.id duplicates ${surface.id}`);
      ids.add(surface.id);
    }
    expectString(surface.category, `${label}.category`, errors);
    if (!statuses.has(surface.status)) errors.push(`${label}.status is invalid`);
    if (!captureMethods.has(surface.capture_method)) errors.push(`${label}.capture_method is invalid`);
    expectStringArray(surface.models, `${label}.models`, errors);
    expectStringArray(surface.modes, `${label}.modes`, errors);
    expectStringArray(surface.dynamic_inputs, `${label}.dynamic_inputs`, errors);
    if (!Array.isArray(surface.artifacts)) errors.push(`${label}.artifacts must be an array`);

    const artifacts = Array.isArray(surface.artifacts) ? surface.artifacts : [];
    if (["current", "verified-unchanged", "stale", "frozen"].includes(surface.status) && artifacts.length === 0) {
      errors.push(`${label} must claim at least one artifact when status is ${surface.status}`);
    }
    if (["gap", "dynamic"].includes(surface.status) && artifacts.length !== 0) {
      errors.push(`${label} must not claim artifacts when status is ${surface.status}`);
    }
    if (surface.status === "dynamic" && (!Array.isArray(surface.dynamic_inputs) || surface.dynamic_inputs.length === 0)) {
      errors.push(`${label} must list dynamic_inputs`);
    }
    if (["gap", "dynamic", "stale", "frozen"].includes(surface.status)) {
      expectString(surface.notes, `${label}.notes`, errors);
    }
    if (["current", "verified-unchanged"].includes(surface.status) && surface.verified_release !== manifest.observed_release) {
      errors.push(`${label}.verified_release must equal observed_release for ${surface.status}`);
    }
    if (["current", "verified-unchanged", "stale", "frozen"].includes(surface.status)) {
      expectString(surface.captured_release, `${label}.captured_release`, errors);
      if (typeof surface.artifact_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(surface.artifact_sha256)) {
        errors.push(`${label}.artifact_sha256 must be a lowercase SHA-256`);
      }
    }
    if (surface.status === "current" && surface.captured_release !== manifest.observed_release) {
      errors.push(`${label}.captured_release must equal observed_release for current surfaces`);
    }

    let pathsValid = true;
    for (const relative of artifacts) {
      if (!isSafeArtifactPath(relative)) {
        errors.push(`${label} has unsafe artifact path ${JSON.stringify(relative)}`);
        pathsValid = false;
        continue;
      }
      const absolute = path.join(repoRoot, provider, relative);
      try {
        const stat = fs.lstatSync(absolute);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
      } catch (error) {
        errors.push(`${label} artifact ${relative} is unavailable (${error.message})`);
        pathsValid = false;
      }
      if (claimed.has(relative)) {
        errors.push(`${label} artifact ${relative} is already claimed by ${claimed.get(relative)}`);
      } else {
        claimed.set(relative, surface.id);
      }
    }
    if (pathsValid && artifacts.length > 0 && /^[0-9a-f]{64}$/.test(surface.artifact_sha256 || "")) {
      const actual = artifactDigest(repoRoot, provider, artifacts);
      if (actual !== surface.artifact_sha256) {
        errors.push(`${label}.artifact_sha256 is stale: expected ${actual}, found ${surface.artifact_sha256}`);
      }
    }

    if (provider === "claude-code" && artifacts.length === 1 && artifacts[0].startsWith("prompts/")) {
      const prompt = path.join(repoRoot, provider, artifacts[0]);
      if (fs.existsSync(prompt)) {
        const text = fs.readFileSync(prompt, "utf8");
        const match = text.match(/\bcc_version=([0-9]+\.[0-9]+\.[0-9]+)/);
        if (match && surface.captured_release !== match[1]) {
          errors.push(`${label}.captured_release ${JSON.stringify(surface.captured_release)} does not match embedded cc_version ${match[1]}`);
        }
      }
    }
  }

  const expectedArtifacts = trackedArtifacts(repoRoot, provider);
  for (const relative of expectedArtifacts) {
    if (!claimed.has(relative)) errors.push(`${provider}: tracked artifact is not claimed by a surface: ${relative}`);
  }
  for (const relative of claimed.keys()) {
    if (!expectedArtifacts.includes(relative)) errors.push(`${provider}: surface claims an unsupported artifact: ${relative}`);
  }

  if (options.requireEvidenceForChangedSurfaces && options.baseRef) {
    let previous;
    try {
      previous = JSON.parse(require("node:child_process").execFileSync(
        "git",
        ["show", `${options.baseRef}:${provider}/SURFACES.json`],
        { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ));
    } catch {
      previous = null;
    }
    const priorById = new Map((previous && previous.surfaces || []).map((surface) => [surface.id, surface]));
    for (const surface of manifest.surfaces || []) {
      const prior = priorById.get(surface.id);
      const changed = !prior || prior.artifact_sha256 !== surface.artifact_sha256 || prior.verified_release !== surface.verified_release;
      if (changed && ["current", "verified-unchanged"].includes(surface.status)) {
        if (typeof surface.evidence_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(surface.evidence_sha256)) {
          errors.push(`${provider}: changed surface ${surface.id} must record evidence_sha256`);
        }
      }
    }
  }

  return { errors, manifestPath, manifest, claimed: [...claimed.keys()].sort() };
}

function renderCatalog(repoRoot, providers = [...providerReleaseFields.keys()].sort()) {
  const lines = [
    "# Agent Autopsy Catalog",
    "",
    "This file is generated from each provider's `SURFACES.json`. Do not edit it directly.",
    "",
    "Status meanings: `current` is captured at the observed release; `verified-unchanged` was checked at that release; `stale` is older; `frozen` has no current capture path; `gap` is known but absent; and `dynamic` is intentionally represented only as a typed input.",
    "",
  ];
  for (const provider of providers) {
    const { manifest } = readManifest(repoRoot, provider);
    lines.push(`## ${provider}`, "", `Observed release: \`${manifest.observed_release}\``, "");
    lines.push("| Surface | Category | Models | Modes | Status | Captured | Artifacts |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const surface of manifest.surfaces) {
      const models = surface.models.length > 0 ? surface.models.map((item) => `\`${item}\``).join(", ") : "—";
      const modes = surface.modes.length > 0 ? surface.modes.map((item) => `\`${item}\``).join(", ") : "—";
      const captured = surface.captured_release ? `\`${surface.captured_release}\`` : "—";
      let artifacts = "—";
      if (surface.artifacts.length > 0 && surface.artifacts.length <= 4) {
        artifacts = surface.artifacts.map((item) => `[${path.posix.basename(item)}](${provider}/${item})`).join(", ");
      } else if (surface.artifacts.length > 4) {
        artifacts = `${surface.artifacts.length} files ([manifest](${provider}/SURFACES.json))`;
      }
      lines.push(`| \`${surface.id}\` | ${surface.category} | ${models} | ${modes} | ${surface.status} | ${captured} | ${artifacts} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function shouldUpdateEvidenceHash(surface, targetRelease) {
  return Boolean(targetRelease)
    && ["current", "verified-unchanged"].includes(surface.status)
    && surface.verified_release === targetRelease;
}

module.exports = {
  artifactDigest,
  providerReleaseFields,
  readManifest,
  renderCatalog,
  shouldUpdateEvidenceHash,
  trackedArtifacts,
  validateManifest,
};
