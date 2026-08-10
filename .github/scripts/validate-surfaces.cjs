#!/usr/bin/env node

const childProcess = require("node:child_process");
const path = require("node:path");
const { providerReleaseFields, renderCatalog, validateManifest } = require("./surface-registry.cjs");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const providers = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const selected = providers.length > 0 ? providers : [...providerReleaseFields.keys()].sort();
const baseRefArgument = process.argv.find((value) => value.startsWith("--base-ref="));
const baseRef = baseRefArgument ? baseRefArgument.slice("--base-ref=".length) : null;
const errors = [];

for (const provider of selected) {
  const result = validateManifest(repoRoot, provider, {
    baseRef,
    requireEvidenceForChangedSurfaces: Boolean(baseRef),
  });
  errors.push(...result.errors);
}

if (selected.length === providerReleaseFields.size) {
  const fs = require("node:fs");
  const catalogPath = path.join(repoRoot, "CATALOG.md");
  const expected = renderCatalog(repoRoot);
  const actual = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, "utf8") : "";
  if (actual !== expected) errors.push("CATALOG.md is not the generated surface catalog; run node .github/scripts/generate-catalog.cjs");
}

if (errors.length > 0) {
  for (const error of errors) console.error(`surface-registry: ${error}`);
  process.exit(1);
}
console.log(`Validated surface registries for: ${selected.join(", ")}`);
