#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const [driverArg, inputHashArg, runId, runAttemptArg, bucket, source] = process.argv.slice(2);
const metadataName = "workflow-run.json";
const sources = new Set(["fresh", "positive_cache", "retry_cache", "capture_only"]);

function fail(message) {
  console.error(message);
  process.exit(2);
}

if (
  !driverArg ||
  !/^[1-9][0-9]*$/.test(runId || "") ||
  !/^[1-9][0-9]*$/.test(runAttemptArg || "") ||
  !/^[0-9]{8}$/.test(bucket || "") ||
  !sources.has(source)
) {
  fail(
    "Usage: write-driver-artifact-metadata.cjs <driver-dir> <input-hash-or-none> <run-id> <attempt> <YYYYMMDD> <source>",
  );
}

const runAttempt = Number(runAttemptArg);
if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) fail("run attempt must be a positive safe integer");

let inputHash = null;
if (source === "capture_only") {
  if (inputHashArg !== "none") fail("capture_only driver metadata requires input hash 'none'");
} else {
  if (!/^[0-9a-f]{64}$/.test(inputHashArg || "")) {
    fail(`${source} driver metadata requires a lowercase SHA-256 input hash`);
  }
  inputHash = inputHashArg;
}

const driverDir = path.resolve(driverArg);
const metadataPath = path.join(driverDir, metadataName);

function requireRealDirectory(directory) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    fail(`driver artifact directory is unavailable: ${error.message}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("driver artifact must be a real directory");
}

function regularFiles(directory, base = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (directory === base && entry.name === metadataName) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(base, absolute).replaceAll("\\", "/");
    if (entry.isSymbolicLink()) fail(`driver artifact contains a symbolic link: ${relative}`);
    if (entry.isDirectory()) files.push(...regularFiles(absolute, base));
    else if (entry.isFile()) files.push({ absolute, relative });
    else fail(`driver artifact contains an unsupported entry: ${relative}`);
  }
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

function bundleHash(directory) {
  const digest = crypto.createHash("sha256");
  for (const file of regularFiles(directory)) {
    const bytes = fs.readFileSync(file.absolute);
    const fileHash = crypto.createHash("sha256").update(bytes).digest("hex");
    digest.update(file.relative, "utf8");
    digest.update("\0");
    digest.update(String(bytes.length), "utf8");
    digest.update("\0");
    digest.update(fileHash, "ascii");
    digest.update("\n");
  }
  return digest.digest("hex");
}

requireRealDirectory(driverDir);
if (fs.existsSync(metadataPath)) {
  const stat = fs.lstatSync(metadataPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("reserved driver workflow metadata path must be a regular file");
  }
  fs.rmSync(metadataPath);
}

const metadata = {
  schema_version: 1,
  input_hash: inputHash,
  run_id: runId,
  run_attempt: runAttempt,
  capture_bucket: bucket,
  source,
  bundle_sha256: bundleHash(driverDir),
};

const temporary = path.join(driverDir, `.workflow-run-${process.pid}.tmp`);
try {
  fs.writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, metadataPath);
} finally {
  fs.rmSync(temporary, { force: true });
}

console.log(`Wrote trusted ${source} driver metadata for attempt ${runAttempt}.`);
