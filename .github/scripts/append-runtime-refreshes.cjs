#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const [planArg, candidatesArg, repoArg] = process.argv.slice(2);
if (!planArg || !candidatesArg) {
  console.error("Usage: append-runtime-refreshes.cjs <plan.json> <current-candidates.json> [repo-root]");
  process.exit(2);
}

const planPath = path.resolve(planArg);
const candidatesPath = path.resolve(candidatesArg);
const repoRoot = path.resolve(repoArg || process.cwd());

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function planHash(entry) {
  return crypto.createHash("sha256").update(`${canonical(entry)}\n`, "utf8").digest("hex");
}

function requestBacked(candidate) {
  const registryPath = path.join(repoRoot, candidate.dir, "SURFACES.json");
  if (!fs.existsSync(registryPath)) return false;
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  return (registry.surfaces || []).some((surface) =>
    ["current", "verified-unchanged"].includes(surface?.status) &&
    typeof surface.capture_method === "string" &&
    surface.capture_method.includes("model-request"));
}

const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
const candidates = JSON.parse(fs.readFileSync(candidatesPath, "utf8"));
if (!Array.isArray(plan) || !Array.isArray(candidates)) throw new Error("plans and candidates must be arrays");

const planned = new Set(plan.map((entry) => entry.tool));
for (const candidate of candidates) {
  if (!candidate || typeof candidate.tool !== "string" || typeof candidate.dir !== "string") continue;
  if (planned.has(candidate.tool) || !requestBacked(candidate)) continue;
  if (candidate.dir !== path.basename(candidate.dir) || candidate.tool !== candidate.dir) {
    throw new Error(`invalid runtime refresh target: ${candidate.tool}`);
  }
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(candidate.new_version) ||
      !/^[0-9a-f]{64}$/.test(candidate.capture_contract_hash)) {
    throw new Error(`${candidate.tool} runtime refresh has invalid release metadata`);
  }
  for (const field of ["old_revision", "new_revision", "mirror_revision"]) {
    if (Object.hasOwn(candidate, field) && !/^[0-9a-f]{40}$/.test(candidate[field])) {
      throw new Error(`${candidate.tool} runtime refresh has invalid ${field}`);
    }
  }
  if (Object.hasOwn(candidate, "artifact_url") &&
      (typeof candidate.artifact_url !== "string" || !candidate.artifact_url.startsWith("https://"))) {
    throw new Error(`${candidate.tool} runtime refresh has invalid artifact_url`);
  }
  if (Object.hasOwn(candidate, "artifact_sha256") && !/^[0-9a-f]{64}$/.test(candidate.artifact_sha256)) {
    throw new Error(`${candidate.tool} runtime refresh has invalid artifact_sha256`);
  }
  if (Object.hasOwn(candidate, "artifact_sha512") && !/^[0-9a-f]{128}$/.test(candidate.artifact_sha512)) {
    throw new Error(`${candidate.tool} runtime refresh has invalid artifact_sha512`);
  }
  if (candidate.old_version !== candidate.new_version) {
    throw new Error(`${candidate.tool} runtime refresh must keep the current release`);
  }
  const entry = { ...candidate, runtime_refresh: true };
  plan.push({ ...entry, plan_hash: planHash(entry) });
  planned.add(candidate.tool);
}

fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
console.log(`Active plan contains ${plan.length} release or runtime refresh(es).`);
