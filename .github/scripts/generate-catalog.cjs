#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { renderCatalog } = require("./surface-registry.cjs");

const repoRoot = childProcess.execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const catalogPath = path.join(repoRoot, "CATALOG.md");
const expected = renderCatalog(repoRoot);

if (process.argv.includes("--check")) {
  const actual = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, "utf8") : "";
  if (actual !== expected) {
    console.error("CATALOG.md is stale; run node .github/scripts/generate-catalog.cjs");
    process.exit(1);
  }
  console.log("CATALOG.md is current.");
} else {
  fs.writeFileSync(catalogPath, expected);
  console.log("Updated CATALOG.md.");
}
