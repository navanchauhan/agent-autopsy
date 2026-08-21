#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = childProcess
  .execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" })
  .trim();
const scratchDir = process.env.CAPTURE_SCRATCH_DIR || path.join(repoRoot, ".capture-scratch");
const changedPath = path.resolve(
  process.argv[2] || process.env.CHANGED_TOOLS_FILE || path.join(scratchDir, "changed-tools.json"),
);
const reviewPath = path.resolve(
  process.argv[3] || process.env.CODEX_REVIEW_FILE || path.join(scratchDir, "review-result.json"),
);

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function hasChanges(dir) {
  return childProcess.execFileSync("git", ["status", "--porcelain", "--", dir], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim() !== "";
}

function versionFields(dir) {
  const versionPath = path.join(repoRoot, dir, "VERSION");
  try {
    const fields = new Map();
    for (const line of fs.readFileSync(versionPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (match && !fields.has(match[1])) fields.set(match[1], match[2]);
    }
    return fields;
  } catch {
    return new Map();
  }
}

function validateArtifactMetadata(tool, fields, errors) {
  if (Object.hasOwn(tool, "artifact_sha256")) {
    if (typeof tool.artifact_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(tool.artifact_sha256)) {
      errors.push(`${tool.tool}: capture plan artifact_sha256 is invalid`);
    } else if (fields.get("sha256") !== tool.artifact_sha256) {
      errors.push(
        `${tool.tool}: ${tool.dir}/VERSION sha256 must equal the pinned artifact SHA-256 ${tool.artifact_sha256}`,
      );
    }
  }

  if (tool.tool !== "antigravity") return;
  if (typeof tool.artifact_url !== "string" || tool.artifact_url.length === 0) {
    errors.push("antigravity: capture plan artifact_url is missing");
  } else if (fields.get("manifest_tarball_url") !== tool.artifact_url) {
    errors.push(
      `antigravity: ${tool.dir}/VERSION manifest_tarball_url must equal the pinned artifact URL`,
    );
  }
  if (typeof tool.artifact_sha512 !== "string" || !/^[0-9a-f]{128}$/.test(tool.artifact_sha512)) {
    errors.push("antigravity: capture plan artifact_sha512 is invalid");
  } else if (fields.get("manifest_tarball_sha512") !== tool.artifact_sha512) {
    errors.push(
      `antigravity: ${tool.dir}/VERSION manifest_tarball_sha512 must equal the pinned artifact SHA-512 ${tool.artifact_sha512}`,
    );
  }
  if (fields.get("manifest_version") !== tool.new_version) {
    errors.push(
      `antigravity: ${tool.dir}/VERSION manifest_version must equal ${tool.new_version}`,
    );
  }
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: node .github/scripts/validate-review.cjs [changed-tools.json] [review-result.json]");
    return;
  }

  const changed = readJson(changedPath, "changed tools");
  const review = readJson(reviewPath, "review result");
  const errors = [];

  if (!Array.isArray(changed)) errors.push("changed tools must be an array");
  if (!Array.isArray(review.issues)) {
    errors.push("review issues must be an array");
  }

  const expected = Array.isArray(changed) ? changed : [];
  const results = Array.isArray(review.tool_results) ? review.tool_results : [];
  if (!Array.isArray(review.tool_results)) errors.push("tool_results must be an array");
  if (results.length !== expected.length) {
    errors.push(`expected ${expected.length} tool result(s), found ${results.length}`);
  }

  const publicationApproval = review.decision === "approve" && review.publish_safe === true;
  const safeNoopReview = review.decision === "retry_capture" && review.publish_safe === false;
  if (!publicationApproval && !safeNoopReview) {
    errors.push("review must approve publication or declare a safe retry");
  }
  if (
    publicationApproval &&
    Array.isArray(review.issues) &&
    review.issues.some((issue) => issue?.severity === "error")
  ) {
    errors.push("an approved review cannot contain top-level error issues");
  }

  let approvedCount = 0;
  let retryCount = 0;
  let heldCount = 0;
  const count = Math.max(expected.length, results.length);
  for (let index = 0; index < count; index += 1) {
    const tool = expected[index];
    const result = results[index];
    if (!tool || !result) continue;
    if (result.tool !== tool.tool) {
      errors.push(`tool result ${index + 1} must be ${JSON.stringify(tool.tool)}`);
      continue;
    }
    if (!Array.isArray(result.issues)) {
      errors.push(`${tool.tool}: issues must be an array`);
      continue;
    }
    if (result.outcome === "approve") {
      approvedCount += 1;
      if (result.issues.some((issue) => issue?.severity === "error")) {
        errors.push(`${tool.tool}: an approved review cannot contain error issues`);
      }
      for (const field of [
        "capture_complete",
        "changes_supported_by_evidence",
        "inventory_consistent",
        "transport_noise_excluded",
        "pii_removed",
        "secret_safe",
      ]) {
        if (result[field] !== true) errors.push(`${tool.tool}: ${field} must be true when approved`);
      }
      const fields = versionFields(tool.dir);
      if (typeof tool.version_field === "string") {
        if (fields.get(tool.version_field) !== tool.new_version) {
          errors.push(
            `${tool.tool}: ${tool.dir}/VERSION ${tool.version_field} must equal ${tool.new_version} when approved`,
          );
        }
        if (typeof tool.new_revision === "string" && fields.get("revision") !== tool.new_revision) {
          errors.push(
            `${tool.tool}: ${tool.dir}/VERSION revision must equal ${tool.new_revision} when approved`,
          );
        }
      }
      validateArtifactMetadata(tool, fields, errors);
    } else if (result.outcome === "retry_capture") {
      retryCount += 1;
      if (result.capture_complete !== false) {
        errors.push(`${tool.tool}: retry_capture requires capture_complete=false`);
      }
      for (const field of ["transport_noise_excluded", "pii_removed", "secret_safe"]) {
        if (result[field] !== true) errors.push(`${tool.tool}: ${field} must be true for a safe retry`);
      }
      if (hasChanges(tool.dir)) {
        errors.push(`${tool.tool}: retry_capture is allowed only when ${tool.dir}/ is unchanged`);
      }
    } else if (result.outcome === "hold") {
      // A hold is the honest verdict when the capture is complete but the
      // candidate still cannot be advanced, so recapturing would yield identical
      // evidence. It requires an unchanged directory and blocks only its own
      // tool, which keeps one stuck provider from failing an otherwise good run.
      // Before this outcome existed the reviewer had to choose `reject`, which
      // failed the whole run and discarded every other tool's approved work.
      heldCount += 1;
      if (result.capture_complete !== true) {
        errors.push(`${tool.tool}: hold requires capture_complete=true; use retry_capture instead`);
      }
      for (const field of ["transport_noise_excluded", "pii_removed", "secret_safe"]) {
        if (result[field] !== true) errors.push(`${tool.tool}: ${field} must be true for a hold`);
      }
      if (hasChanges(tool.dir)) {
        errors.push(`${tool.tool}: hold is allowed only when ${tool.dir}/ is unchanged`);
      }
    } else {
      errors.push(`${tool.tool}: outcome ${JSON.stringify(result.outcome)} is not publishable`);
    }
  }

  if (publicationApproval && expected.length > 0 && approvedCount === 0) {
    errors.push("at least one changed tool must be approved for publication");
  }
  if (safeNoopReview && retryCount + heldCount !== expected.length) {
    errors.push("a safe retry requires every changed tool to remain an unchanged retry_capture or hold");
  }
  if (safeNoopReview && retryCount === 0) {
    errors.push("a safe retry requires at least one retry_capture; an all-hold review must not request recapture");
  }
  if (errors.length > 0) {
    console.error(`Review validation failed with ${errors.length} error(s):`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log(`Review validation passed for ${expected.length} tool(s).`);
}

main();
