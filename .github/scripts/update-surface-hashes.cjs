#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { artifactDigest, providerReleaseFields } = require("./surface-registry.cjs");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const requested = process.argv.slice(2);
const providers = requested.length > 0 ? requested : [...providerReleaseFields.keys()].sort();
const evidenceManifestPath = process.env.DRIVER_INPUT_MANIFEST || path.join(repoRoot, ".capture-scratch", "driver-input.json");
const changedToolsPath = process.env.CHANGED_TOOLS_FILE || path.join(repoRoot, ".capture-scratch", "changed-tools.json");
let evidenceByProvider = new Map();
if (fs.existsSync(evidenceManifestPath) && fs.existsSync(changedToolsPath)) {
  const driverInput = JSON.parse(fs.readFileSync(evidenceManifestPath, "utf8"));
  const changedTools = JSON.parse(fs.readFileSync(changedToolsPath, "utf8"));
  evidenceByProvider = new Map(changedTools.map((entry) => [entry.dir, driverInput.per_tool?.[entry.tool]]));
}

for (const provider of providers) {
  if (!providerReleaseFields.has(provider)) throw new Error(`unknown provider: ${provider}`);
  const manifestPath = path.join(repoRoot, provider, "SURFACES.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const surface of manifest.surfaces) {
    if (surface.artifacts.length > 0) {
      surface.artifact_sha256 = artifactDigest(repoRoot, provider, surface.artifacts);
    } else {
      delete surface.artifact_sha256;
    }
    const evidence = evidenceByProvider.get(provider);
    if (evidence && ["current", "verified-unchanged"].includes(surface.status)) {
      surface.evidence_sha256 = evidence;
    }
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`Updated surface artifact hashes for: ${providers.join(", ")}`);
