#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TOOLS = ["codex", "claude-code", "grok", "antigravity", "qwen-code"];
const LEGACY_TOOLS = ["codex", "claude-code", "grok", "antigravity"];
const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const SPECS = {
  codex: {
    dir: "codex",
    versionField: "codex_cli_package_version",
    targetKeys: ["tool", "new_version", "new_revision"],
    requiresRevision: true,
  },
  "claude-code": {
    dir: "claude-code",
    versionField: "version",
    targetKeys: ["tool", "new_version", "artifact_url", "artifact_sha256"],
    requiresRevision: false,
  },
  grok: {
    dir: "grok",
    versionField: "version",
    targetKeys: [
      "tool",
      "new_version",
      "new_revision",
      "mirror_revision",
      "artifact_url",
      "artifact_sha256",
    ],
    requiresRevision: true,
  },
  antigravity: {
    dir: "antigravity",
    versionField: "version",
    targetKeys: ["tool", "new_version", "artifact_url", "artifact_sha512"],
    requiresRevision: false,
  },
  "qwen-code": {
    dir: "qwen-code",
    versionField: "version",
    targetKeys: ["tool", "new_version", "new_revision"],
    requiresRevision: true,
  },
};

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isObject(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} must contain exactly: ${wanted.join(", ")}`);
  }
}

function parseSemver(value, label) {
  if (typeof value !== "string") fail(`${label} must be a semantic version string`);
  const match = SEMVER.exec(value);
  if (!match) fail(`${label} is not a supported semantic version`);
  const prerelease = match[4] === undefined ? null : match[4].split(".");
  if (prerelease !== null) {
    for (const identifier of prerelease) {
      if (identifier.length === 0 || (/^[0-9]+$/.test(identifier) && identifier.length > 1 && identifier[0] === "0")) {
        fail(`${label} has an invalid prerelease identifier`);
      }
    }
  }
  return {
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease,
  };
}

function compareSemver(left, right) {
  const a = parseSemver(left, "left version");
  const b = parseSemver(right, "right version");
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] < b.core[index]) return -1;
    if (a.core[index] > b.core[index]) return 1;
  }
  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    const aNumeric = /^[0-9]+$/.test(a.prerelease[index]);
    const bNumeric = /^[0-9]+$/.test(b.prerelease[index]);
    if (aNumeric && bNumeric) {
      const aNumber = BigInt(a.prerelease[index]);
      const bNumber = BigInt(b.prerelease[index]);
      if (aNumber < bNumber) return -1;
      if (aNumber > bNumber) return 1;
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else if (a.prerelease[index] < b.prerelease[index]) {
      return -1;
    } else if (a.prerelease[index] > b.prerelease[index]) {
      return 1;
    }
  }
  return 0;
}

function requireStableVersion(value, label) {
  const parsed = parseSemver(value, label);
  if (parsed.prerelease !== null) fail(`${label} must be a stable numeric x.y.z release`);
  return parsed;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail("cannot canonicalize an unsupported JSON value");
  return encoded;
}

function planHash(plan) {
  // jq emits one trailing newline for `jq -cS .`; include it in the digest.
  return crypto.createHash("sha256").update(`${canonicalJson(plan)}\n`, "utf8").digest("hex");
}

function readJson(file, label, missingIsEmpty = false) {
  if (missingIsEmpty && (file === "-" || !fs.existsSync(file))) return null;
  let text;
  try {
    const bytes = fs.readFileSync(file);
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail(`${label} could not be read: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

function validateCurrentState(raw) {
  exactKeys(raw, TOOLS, "current state");
  const state = {};
  for (const tool of TOOLS) {
    const spec = SPECS[tool];
    const keys = spec.requiresRevision
      ? ["version", "revision", "capture_contract_hash"]
      : ["version", "capture_contract_hash"];
    exactKeys(raw[tool], keys, `current state for ${tool}`);
    requireStableVersion(raw[tool].version, `current state version for ${tool}`);
    if (!HEX_64.test(raw[tool].capture_contract_hash)) {
      fail(`current state capture contract for ${tool} must be a lowercase SHA-256 digest`);
    }
    if (spec.requiresRevision && !HEX_40.test(raw[tool].revision)) {
      fail(`current state revision for ${tool} must be a lowercase 40-character Git revision`);
    }
    state[tool] = { ...raw[tool] };
  }
  return state;
}

function validateTargetMetadata(raw, tool, label) {
  const version = raw.new_version;
  requireStableVersion(version, `${label}.new_version`);
  switch (tool) {
    case "codex":
    case "qwen-code":
      if (!HEX_40.test(raw.new_revision)) fail(`${label}.new_revision must be a lowercase 40-character Git revision`);
      return { tool, new_version: version, new_revision: raw.new_revision };
    case "claude-code": {
      const expectedUrl = `https://downloads.claude.ai/claude-code-releases/${version}/linux-x64/claude`;
      if (raw.artifact_url !== expectedUrl) fail(`${label}.artifact_url does not match its Claude Code version`);
      if (!HEX_64.test(raw.artifact_sha256)) fail(`${label}.artifact_sha256 must be a lowercase SHA-256 digest`);
      return { tool, new_version: version, artifact_url: expectedUrl, artifact_sha256: raw.artifact_sha256 };
    }
    case "grok": {
      const expectedUrl = `https://x.ai/cli/grok-${version}-linux-x86_64`;
      if (!HEX_40.test(raw.new_revision)) fail(`${label}.new_revision must be a lowercase 40-character Git revision`);
      if (!HEX_40.test(raw.mirror_revision)) fail(`${label}.mirror_revision must be a lowercase 40-character Git revision`);
      if (raw.artifact_url !== expectedUrl) fail(`${label}.artifact_url does not match its Grok version`);
      if (!HEX_64.test(raw.artifact_sha256)) fail(`${label}.artifact_sha256 must be a lowercase SHA-256 digest`);
      return {
        tool,
        new_version: version,
        new_revision: raw.new_revision,
        mirror_revision: raw.mirror_revision,
        artifact_url: expectedUrl,
        artifact_sha256: raw.artifact_sha256,
      };
    }
    case "antigravity": {
      const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const expectedUrl = new RegExp(
        `^https://storage\\.googleapis\\.com/antigravity-public/antigravity-cli/${escapedVersion}-[0-9]+/linux-x64/cli_linux_x64\\.tar\\.gz$`,
      );
      if (typeof raw.artifact_url !== "string" || !expectedUrl.test(raw.artifact_url)) {
        fail(`${label}.artifact_url does not match its Antigravity version`);
      }
      if (!HEX_128.test(raw.artifact_sha512)) fail(`${label}.artifact_sha512 must be a lowercase SHA-512 digest`);
      return {
        tool,
        new_version: version,
        artifact_url: raw.artifact_url,
        artifact_sha512: raw.artifact_sha512,
      };
    }
    default:
      fail(`${label}.tool is unsupported`);
  }
}

function basePlanFrom(raw, target, label) {
  const tool = target.tool;
  const spec = SPECS[tool];
  requireStableVersion(raw.old_version, `${label}.old_version`);
  if (compareSemver(raw.old_version, target.new_version) >= 0) {
    fail(`${label}.new_version must be newer than its old_version`);
  }
  if (raw.dir !== spec.dir) fail(`${label}.dir must be ${spec.dir}`);
  if (raw.version_field !== spec.versionField) fail(`${label}.version_field must be ${spec.versionField}`);
  if (!HEX_64.test(raw.capture_contract_hash)) {
    fail(`${label}.capture_contract_hash must be a lowercase SHA-256 digest`);
  }
  const plan = {
    tool,
    dir: spec.dir,
    old_version: raw.old_version,
    new_version: target.new_version,
    version_field: spec.versionField,
  };
  if (spec.requiresRevision) {
    if (!HEX_40.test(raw.old_revision)) fail(`${label}.old_revision must be a lowercase 40-character Git revision`);
    plan.old_revision = raw.old_revision;
    plan.new_revision = target.new_revision;
  }
  if (tool === "claude-code" || tool === "grok") {
    if (tool === "grok") plan.mirror_revision = target.mirror_revision;
    plan.artifact_url = target.artifact_url;
    plan.artifact_sha256 = target.artifact_sha256;
  } else if (tool === "antigravity") {
    plan.artifact_url = target.artifact_url;
    plan.artifact_sha512 = target.artifact_sha512;
  }
  plan.capture_contract_hash = raw.capture_contract_hash;
  return plan;
}

function sanitizePlanEntry(raw, label) {
  if (!isObject(raw) || !TOOLS.includes(raw.tool)) fail(`${label}.tool must name a supported tool`);
  const spec = SPECS[raw.tool];
  const planKeys = [
    "tool",
    "dir",
    "old_version",
    "new_version",
    "version_field",
    ...(spec.requiresRevision ? ["old_revision"] : []),
    ...spec.targetKeys.filter((key) => key !== "tool" && key !== "new_version"),
    "capture_contract_hash",
    "plan_hash",
  ];
  exactKeys(raw, planKeys, label);
  const target = validateTargetMetadata(raw, raw.tool, label);
  const plan = basePlanFrom(raw, target, label);
  if (!HEX_64.test(raw.plan_hash) || raw.plan_hash !== planHash(plan)) {
    fail(`${label}.plan_hash does not match its canonical plan`);
  }
  return target;
}

function sanitizeStoredTarget(raw, queuedTool, label) {
  if (!isObject(raw) || raw.tool !== queuedTool) fail(`${label}.tool must equal its queue name`);
  exactKeys(raw, SPECS[queuedTool].targetKeys, label);
  return validateTargetMetadata(raw, queuedTool, label);
}

function emptyLedger() {
  return {
    schema_version: 1,
    queues: Object.fromEntries(TOOLS.map((tool) => [tool, []])),
  };
}

function readLedger(raw) {
  const result = emptyLedger();
  if (raw === null) return result;
  if (Array.isArray(raw)) {
    raw.forEach((entry, index) => {
      const target = sanitizePlanEntry(entry, `legacy ledger entry ${index}`);
      result.queues[target.tool].push(target);
    });
    return result;
  }
  exactKeys(raw, ["schema_version", "queues"], "release ledger");
  if (raw.schema_version !== 1) fail("release ledger schema_version must be 1");
  const queueKeys = Object.keys(raw.queues || {}).sort();
  const currentKeys = [...TOOLS].sort();
  const legacyKeys = [...LEGACY_TOOLS].sort();
  const currentShape = queueKeys.length === currentKeys.length && queueKeys.every((key, index) => key === currentKeys[index]);
  const legacyShape = queueKeys.length === legacyKeys.length && queueKeys.every((key, index) => key === legacyKeys[index]);
  if (!currentShape && !legacyShape) fail(`release ledger queues must contain exactly: ${currentKeys.join(", ")}`);
  for (const tool of TOOLS) {
    const queue = raw.queues[tool] ?? [];
    if (!Array.isArray(queue)) fail(`release ledger queue for ${tool} must be an array`);
    result.queues[tool] = queue.map((entry, index) => (
      sanitizeStoredTarget(entry, tool, `release ledger ${tool} entry ${index}`)
    ));
  }
  return result;
}

function readFreshPlan(raw) {
  if (!Array.isArray(raw)) fail("fresh plan must be an array");
  return raw.map((entry, index) => sanitizePlanEntry(entry, `fresh plan entry ${index}`));
}

function reconcile(ledger, fresh, state) {
  const queues = Object.fromEntries(TOOLS.map((tool) => [tool, new Map()]));
  for (const tool of TOOLS) {
    const prior = [...ledger.queues[tool]].sort((left, right) => compareSemver(left.new_version, right.new_version));
    if (prior.length > 0 && compareSemver(state[tool].version, prior[0].new_version) > 0) {
      fail(
        `${tool} VERSION advanced to ${state[tool].version} past queued head ${prior[0].new_version}; refusing to silently skip a release`,
      );
    }
  }
  const add = (target) => {
    const current = state[target.tool].version;
    if (compareSemver(target.new_version, current) <= 0) return;
    const toolQueue = queues[target.tool];
    const existing = toolQueue.get(target.new_version);
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(target)) {
      fail(`conflicting metadata for ${target.tool} ${target.new_version}`);
    }
    if (existing === undefined) toolQueue.set(target.new_version, target);
  };
  for (const tool of TOOLS) {
    for (const target of ledger.queues[tool]) add(target);
  }
  for (const target of fresh) add(target);

  const output = emptyLedger();
  for (const tool of TOOLS) {
    output.queues[tool] = [...queues[tool].values()].sort((left, right) => (
      compareSemver(left.new_version, right.new_version)
    ));
  }
  return output;
}

function buildHeadPlan(ledger, state) {
  const result = [];
  for (const tool of TOOLS) {
    const target = ledger.queues[tool][0];
    if (target === undefined) continue;
    const spec = SPECS[tool];
    const base = {
      tool,
      dir: spec.dir,
      old_version: state[tool].version,
      new_version: target.new_version,
      version_field: spec.versionField,
    };
    if (spec.requiresRevision) {
      base.old_revision = state[tool].revision;
      base.new_revision = target.new_revision;
    }
    if (tool === "claude-code" || tool === "grok") {
      if (tool === "grok") base.mirror_revision = target.mirror_revision;
      base.artifact_url = target.artifact_url;
      base.artifact_sha256 = target.artifact_sha256;
    } else if (tool === "antigravity") {
      base.artifact_url = target.artifact_url;
      base.artifact_sha512 = target.artifact_sha512;
    }
    base.capture_contract_hash = state[tool].capture_contract_hash;
    result.push({ ...base, plan_hash: planHash(base) });
  }
  return result;
}

function writeJson(file, value) {
  const parent = path.dirname(path.resolve(file));
  fs.mkdirSync(parent, { recursive: true });
  const temporary = path.join(parent, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // The successful rename already removed the temporary path.
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 5) {
    fail("usage: release-ledger.cjs <ledger-in-or-dash> <fresh-plan-json> <current-state-json> <ledger-out> <head-plan-out>");
  }
  const [ledgerInput, freshInput, stateInput, ledgerOutput, headOutput] = args;
  if (path.resolve(ledgerOutput) === path.resolve(headOutput)) fail("ledger and head-plan outputs must be different files");
  const state = validateCurrentState(readJson(stateInput, "current state"));
  const ledger = readLedger(readJson(ledgerInput, "release ledger", true));
  const fresh = readFreshPlan(readJson(freshInput, "fresh plan"));
  const reconciled = reconcile(ledger, fresh, state);
  const head = buildHeadPlan(reconciled, state);
  writeJson(ledgerOutput, reconciled);
  writeJson(headOutput, head);
}

try {
  main();
} catch (error) {
  process.stderr.write(`release-ledger: ${error.message}\n`);
  process.exitCode = 1;
}
