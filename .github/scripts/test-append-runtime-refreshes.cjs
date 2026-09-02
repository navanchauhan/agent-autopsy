const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = path.join(__dirname, "append-runtime-refreshes.cjs");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

test("adds only unplanned request-backed harnesses at their current release", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-refreshes-"));
  const planPath = path.join(root, "plan.json");
  const candidatesPath = path.join(root, "candidates.json");
  for (const [provider, method] of [["live", "model-request"], ["source", "direct-source"]]) {
    fs.mkdirSync(path.join(root, provider));
    fs.writeFileSync(path.join(root, provider, "SURFACES.json"), JSON.stringify({
      surfaces: [{ status: "current", capture_method: method }],
    }));
  }
  fs.writeFileSync(planPath, "[]\n");
  fs.writeFileSync(candidatesPath, JSON.stringify([
    { tool: "live", dir: "live", old_version: "1.2.3", new_version: "1.2.3", capture_contract_hash: "a".repeat(64) },
    { tool: "source", dir: "source", old_version: "1.2.3", new_version: "1.2.3", capture_contract_hash: "b".repeat(64) },
  ]));

  const result = childProcess.spawnSync(process.execPath, [script, planPath, candidatesPath, root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  assert.equal(plan.length, 1);
  assert.equal(plan[0].tool, "live");
  assert.equal(plan[0].runtime_refresh, true);
  const { plan_hash: hash, ...entry } = plan[0];
  assert.equal(hash, crypto.createHash("sha256").update(`${canonical(entry)}\n`).digest("hex"));
});

test("does not replace a release plan for the same harness", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-refreshes-release-"));
  fs.mkdirSync(path.join(root, "live"));
  fs.writeFileSync(path.join(root, "live", "SURFACES.json"), JSON.stringify({
    surfaces: [{ status: "current", capture_method: "source-and-model-request" }],
  }));
  const planPath = path.join(root, "plan.json");
  const candidatesPath = path.join(root, "candidates.json");
  fs.writeFileSync(planPath, JSON.stringify([{ tool: "live", dir: "live", old_version: "1.2.3", new_version: "1.2.4" }]));
  fs.writeFileSync(candidatesPath, JSON.stringify([
    { tool: "live", dir: "live", old_version: "1.2.3", new_version: "1.2.3" },
  ]));
  const result = childProcess.spawnSync(process.execPath, [script, planPath, candidatesPath, root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(planPath, "utf8")), [
    { tool: "live", dir: "live", old_version: "1.2.3", new_version: "1.2.4" },
  ]);
});
