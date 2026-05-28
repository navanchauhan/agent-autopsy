#!/usr/bin/env node

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_OUT_DIR = path.resolve(process.cwd(), "ampcode");
const DEFAULT_MODES = ["smart", "deep", "large", "rush"];
const AMP = process.env.AMP_BIN || "amp";

function execFile(command, args) {
  return childProcess.execFileSync(command, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
  });
}

function execOrUnknown(command, args) {
  try {
    return execFile(command, args).trim();
  } catch {
    return "unknown";
  }
}

function shaFile(filePath, algorithm) {
  try {
    const hash = crypto.createHash(algorithm);
    hash.update(fs.readFileSync(filePath));
    return hash.digest("hex");
  } catch {
    return "unknown";
  }
}

function displayPath(filePath) {
  const home = process.env.HOME;
  return home && filePath.startsWith(home)
    ? filePath.replace(home, "/Users/example")
    : filePath;
}

function safeFileName(name) {
  return name.replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function removeGeneratedFiles(dir, extension) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(extension)) {
      fs.rmSync(path.join(dir, entry.name));
    }
  }
}

function ampArgs(...args) {
  return [
    ...args,
    "--dangerously-allow-all",
    "--no-ide",
    "--no-notifications",
  ];
}

function listTools(mode) {
  return JSON.parse(execFile(AMP, ampArgs("tools", "list", "--json", "--mode", mode)));
}

function showTool(mode, name) {
  return JSON.parse(execFile(AMP, ampArgs("tools", "show", name, "--json", "--mode", mode)));
}

function main() {
  const outDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT_DIR;
  const modes = process.env.AMP_MODES
    ? process.env.AMP_MODES.split(",").map((mode) => mode.trim()).filter(Boolean)
    : DEFAULT_MODES;

  const toolsDir = path.join(outDir, "tools");
  fs.mkdirSync(toolsDir, { recursive: true });
  removeGeneratedFiles(toolsDir, ".json");

  const failures = [];
  const groups = new Map();
  const modeToolNames = {};

  for (const mode of modes) {
    try {
      const listed = listTools(mode);
      modeToolNames[mode] = listed.map((tool) => tool.name).sort();

      for (const tool of listed) {
        const schema = showTool(mode, tool.name);
        if (!groups.has(tool.name)) groups.set(tool.name, new Map());
        const variants = groups.get(tool.name);
        const signature = JSON.stringify(schema);
        if (!variants.has(signature)) {
          variants.set(signature, {
            modes: new Set(),
            schema,
          });
        }
        variants.get(signature).modes.add(mode);
      }
    } catch (error) {
      failures.push(`${mode}: ${error.message || error}`);
    }
  }

  for (const [name, variantsMap] of [...groups.entries()].sort()) {
    const variants = [...variantsMap.values()].map((variant) => ({
      modes: [...variant.modes].sort(),
      schema: variant.schema,
    }));
    const value =
      variants.length === 1
        ? {
            name,
            note:
              "The schema field is the exact Amp CLI `tools show --json` definition observed for the listed mode(s).",
            modes: variants[0].modes,
            schema: variants[0].schema,
          }
        : {
            name,
            note:
              "This Amp tool had different `tools show --json` definitions across modes. Each nested schema is exact for the listed mode(s).",
            variants,
          };
    writeJson(path.join(toolsDir, `${safeFileName(name)}.json`), value);
  }

  const version = execOrUnknown(AMP, ["version"]);
  let binaryPath = "unknown";
  try {
    binaryPath = fs.realpathSync(AMP);
  } catch {}
  const promptCount = fs.existsSync(path.join(outDir, "prompts"))
    ? fs.readdirSync(path.join(outDir, "prompts")).filter((name) => name.endsWith(".md")).length
    : 0;
  const toolNames = [...groups.keys()].sort();

  const versionLines = [
    "source = ampcode/amp",
    "distribution = native Bun binary",
    `version = ${version}`,
    "platform = darwin-arm64",
    `launcher_path = ${displayPath(AMP)}`,
    `binary_path = ${displayPath(binaryPath)}`,
    `sha256 = ${shaFile(binaryPath, "sha256")}`,
    `sha512 = ${shaFile(binaryPath, "sha512")}`,
    `generated_at = ${new Date().toISOString()}`,
    "auth_source = local Amp auth",
    "trace_script = ampcode/misc/scripts/trace-amp-runtime.cjs",
    "tool_script = ampcode/misc/scripts/extract-amp-tools.cjs",
    "capture = tmux interactive session with `BUN_OPTIONS=--preload=ampcode/misc/scripts/trace-amp-runtime.cjs amp --dangerously-allow-all --no-ide --no-notifications` plus `amp tools show --json` for each mode",
    `modes = ${modes.join(", ")}`,
    `prompt_models = ${promptCount ? "see ampcode/prompts" : "unknown"}`,
    `prompts = ${promptCount}`,
    `tools = ${toolNames.length}`,
    `tool_names = ${toolNames.join(", ")}`,
  ];
  if (failures.length > 0) {
    versionLines.push(`tool_capture_failures = ${failures.join(" | ")}`);
  }
  for (const mode of Object.keys(modeToolNames).sort()) {
    versionLines.push(`mode_${mode}_tools = ${modeToolNames[mode].join(", ")}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "VERSION"), `${versionLines.join("\n")}\n`);
}

main();
