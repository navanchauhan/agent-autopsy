#!/usr/bin/env node

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_OUT_DIR = path.resolve(process.cwd(), "claude-code", "interactive");

function usage() {
  console.error(
    "Usage: node claude-code/scripts/extract-claude-trace.cjs <trace-dir> [out-dir]",
  );
  process.exit(2);
}

function safeFileName(name) {
  return name.replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function execOrUnknown(command) {
  try {
    return childProcess.execSync(command, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function sha256File(filePath) {
  try {
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(filePath));
    return hash.digest("hex");
  } catch {
    return "unknown";
  }
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

function harnessVariable(value) {
  return `<harnessVariable>${value}</harnessVariable>`;
}

function replaceAllLiteral(text, search, replacement) {
  return text.split(search).join(replacement);
}

function firstMatch(text, regexp) {
  return text.match(regexp)?.[1] || "";
}

function markHarnessVariables(text) {
  let out = text;
  const literalExamples = [];
  const addLiteralExample = (value) => {
    if (value && !literalExamples.includes(value)) literalExamples.push(value);
  };

  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?(?:Primary )?Working directory: (.+)$/m));
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Primary working directory: (.+)$/m));
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?OS Version: (.+)$/m));
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Today's date: (.+)$/m));
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Current date: (.+)$/m));
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Claude Code version: (.+)$/m));
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Model: (.+)$/m));
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Session ID: (.+)$/m));
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Memory directory: (.+)$/m));

  for (const match of text.matchAll(/\/Users\/navanchauhan\/[^\s<>"')\]]+/g)) {
    addLiteralExample(match[0]);
  }
  for (const match of text.matchAll(/\bcc_version=[^;\n]+; cc_entrypoint=[^;\n]+; cch=[^;\n]+;/g)) {
    addLiteralExample(match[0]);
  }
  for (const match of text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)) {
    addLiteralExample(match[0]);
  }

  for (const value of literalExamples.sort((a, b) => b.length - a.length)) {
    out = replaceAllLiteral(out, value, harnessVariable(value));
  }

  return out;
}

function readRecords(traceDir) {
  const records = [];
  for (const entry of fs.readdirSync(traceDir).sort()) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(traceDir, entry);
    const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!record.request?.body) continue;
    let body;
    try {
      body = JSON.parse(record.request.body);
    } catch {
      continue;
    }
    records.push({ file: entry, record, body });
  }
  return records;
}

function systemText(body) {
  if (typeof body.system === "string") return body.system;
  if (!Array.isArray(body.system)) return "";
  return body.system
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function requestText(record) {
  return JSON.stringify(record.body);
}

function selectPromptRecord(records) {
  const traceRecords = records.filter((record) => /CLAUDE.*TRACE_OK/.test(requestText(record)));
  return traceRecords.at(-1) || records.at(-1);
}

function renderPrompt(records) {
  const selected = selectPromptRecord(records);
  return `${markHarnessVariables(systemText(selected.body)).trimEnd()}\n`;
}

function groupTools(records) {
  const groups = new Map();
  for (const record of records) {
    const model = record.body.model || "unknown";
    for (const tool of record.body.tools || []) {
      const name = tool.name;
      if (!name) continue;
      if (!groups.has(name)) groups.set(name, new Map());
      const variants = groups.get(name);
      const signature = JSON.stringify(tool);
      if (!variants.has(signature)) {
        variants.set(signature, {
          models: new Set(),
          trace_files: new Set(),
          schema: tool,
        });
      }
      const variant = variants.get(signature);
      variant.models.add(model);
      variant.trace_files.add(record.file);
    }
  }
  return groups;
}

function main() {
  const traceDir = process.argv[2] ? path.resolve(process.argv[2]) : "";
  if (!traceDir) usage();

  const outDir = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUT_DIR;
  const promptsDir = path.join(outDir, "prompts");
  const toolsDir = path.join(outDir, "tools");
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  removeGeneratedFiles(promptsDir, ".md");
  removeGeneratedFiles(toolsDir, ".json");

  const records = readRecords(traceDir).filter((record) => systemText(record.body));
  if (records.length === 0) {
    throw new Error(`No Claude /v1/messages records with system prompts found in ${traceDir}`);
  }

  const agentRecords = records.filter((record) => (record.body.tools || []).length > 0);
  const promptRecords = agentRecords.length > 0 ? agentRecords : records;
  const byModel = new Map();
  for (const record of promptRecords) {
    const model = record.body.model || "unknown";
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model).push(record);
  }

  for (const [model, modelRecords] of byModel.entries()) {
    fs.writeFileSync(
      path.join(promptsDir, `${safeFileName(model)}.md`),
      renderPrompt(modelRecords),
    );
  }

  const toolGroups = groupTools(agentRecords);
  for (const [name, variantsMap] of [...toolGroups.entries()].sort()) {
    const variants = [...variantsMap.values()].map((variant) => ({
      models: [...variant.models].sort(),
      trace_files: [...variant.trace_files].sort(),
      schema: variant.schema,
    }));
    const value =
      variants.length === 1
        ? {
            name,
            note:
              "The schema field is the exact Claude /v1/messages tools[] object sent in the traced interactive request.",
            models: variants[0].models,
            trace_files: variants[0].trace_files,
            schema: variants[0].schema,
          }
        : {
            name,
            note:
              "This tool had different exact Claude /v1/messages tools[] payloads across traced interactive requests. Each variant schema is exact.",
            variants,
          };
    writeJson(path.join(toolsDir, `${safeFileName(name)}.json`), value);
  }

  const claudePath = execOrUnknown("command -v claude");
  const installedVersion = execOrUnknown("claude --version");
  const userAgents = [
    ...new Set(
      records
        .map((record) => record.record.request.headers?.["user-agent"])
        .filter(Boolean),
    ),
  ].sort();
  const capturedVersion =
    userAgents
      .map((userAgent) => userAgent.match(/claude-cli\/([0-9.]+)/)?.[1])
      .find(Boolean) || installedVersion.replace(/\s+\(Claude Code\)$/, "");
  const capturedBinaryPath = `/Users/navanchauhan/.local/share/claude/versions/${capturedVersion}`;
  const binaryPath = fs.existsSync(capturedBinaryPath) ? capturedBinaryPath : claudePath;
  const modelNames = [...byModel.keys()].sort();
  const toolNames = [...toolGroups.keys()].sort();
  const versionLines = [
    "source = anthropic-ai/claude-code",
    "distribution = native Bun binary",
    `version = ${capturedVersion}`,
    `installed_version_at_extract = ${installedVersion}`,
    "platform = darwin-arm64",
    `binary_path = ${binaryPath}`,
    `sha256 = ${sha256File(binaryPath)}`,
    `capture_user_agent = ${userAgents.join(" | ")}`,
    `generated_at = ${new Date().toISOString()}`,
    "auth_source = local Claude Code Anthropic auth/keychain; ANTHROPIC_API_KEY was unset",
    "trace_script = claude-code/scripts/trace-claude-messages.cjs",
    "extract_script = claude-code/scripts/extract-claude-trace.cjs",
    "trace_source = local Bun preload /v1/messages trace (not stored)",
    "capture = tmux interactive session with `BUN_OPTIONS=--preload claude-code/scripts/trace-claude-messages.cjs claude --dangerously-skip-permissions --strict-mcp-config --tools default` and prompt `Reply exactly: CLAUDE_INTERACTIVE_TRACE_OK`",
    `prompt_models = ${modelNames.join(", ")}`,
    `prompts = ${modelNames.length}`,
    `tools = ${toolNames.length}`,
    `tool_names = ${toolNames.join(", ")}`,
  ];
  fs.writeFileSync(path.join(outDir, "VERSION"), `${versionLines.join("\n")}\n`);
}

main();
