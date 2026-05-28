#!/usr/bin/env node

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_OUT_DIR = path.resolve(process.cwd(), "claude-code");

function usage() {
  console.error(
    "Usage: node claude-code/misc/scripts/extract-claude-trace.cjs <trace-dir> [out-dir]",
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

function removeMatchingFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && predicate(entry.name)) {
      fs.rmSync(path.join(dir, entry.name));
    }
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeList(target, key, values) {
  target[key] = [...new Set([...(target[key] || []), ...(values || [])].filter(Boolean))];
}

function mergeInteractiveTool(toolPath, name, interactiveVariants) {
  const incoming = interactiveVariants.map((variant) => ({
    models: variant.models,
    runs: ["interactive"],
    request_kind: "agent",
    capture_modes: ["interactive"],
    trace_files: variant.trace_files,
    schema: variant.schema,
  }));

  if (!fs.existsSync(toolPath)) {
    writeJson(toolPath, {
      name,
      note:
        "This tool was observed in an interactive Claude /v1/messages request. Each schema entry below is an exact tools[] object.",
      variants: incoming,
    });
    return;
  }

  const existing = JSON.parse(fs.readFileSync(toolPath, "utf8"));
  if (Array.isArray(existing.variants)) {
    existing.note =
      "This tool had different exact payloads across traced model requests and capture modes. Each schema entry below is an exact Claude /v1/messages tools[] object sent to the listed model(s)/capture mode(s).";
    for (const variant of existing.variants) {
      if (!variant.capture_modes) variant.capture_modes = ["non-interactive"];
    }
    for (const next of incoming) {
      const match = existing.variants.find((variant) => sameJson(variant.schema, next.schema));
      if (match) {
        mergeList(match, "capture_modes", next.capture_modes);
        mergeList(match, "models", next.models);
        mergeList(match, "trace_files", next.trace_files);
        mergeList(match, "runs", next.runs);
      } else {
        existing.variants.push(next);
      }
    }
    writeJson(toolPath, existing);
    return;
  }

  const exactExistingSchema = existing.schema || existing;
  const unmatched = incoming.filter((next) => !sameJson(exactExistingSchema, next.schema));
  if (unmatched.length === 0) return;

  writeJson(toolPath, {
    name: existing.name || name,
    note:
      "This tool had different exact payloads across traced capture modes. Each schema entry below is an exact Claude /v1/messages tools[] object sent to the listed capture mode.",
    variants: [
      {
        runs: ["non-interactive"],
        request_kind: "agent",
        capture_modes: ["non-interactive"],
        schema: exactExistingSchema,
      },
      ...unmatched,
    ],
  });
}

function harnessVariable(value) {
  return `<harnessVariable>${value}</harnessVariable>`;
}

function harnessBlock(value) {
  return `<harnessVariable>\n${value}\n</harnessVariable>`;
}

function replaceAllLiteral(text, search, replacement) {
  return text.split(search).join(replacement);
}

function firstMatch(text, regexp) {
  return text.match(regexp)?.[1] || "";
}

function wrapIfNeeded(value) {
  return value.includes("<harnessVariable>") ? value : harnessVariable(value);
}

function markLineValue(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`^(${escaped}: )([^\\n]+)$`, "gm"), (_, prefix, value) => {
    return `${prefix}${wrapIfNeeded(value)}`;
  });
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

  for (const label of [
    " - Is a git repository",
    " - Platform",
    " - Shell",
    "Current branch",
    "Main branch (you will usually use this for PRs)",
    "Git user",
  ]) {
    out = markLineValue(out, label);
  }

  out = out.replace(
    /( - You are powered by the model named )(.+?)(\. The exact model ID is )(.+?)(\.)/g,
    (_, prefix, modelName, middle, modelId, suffix) =>
      `${prefix}${wrapIfNeeded(modelName)}${middle}${wrapIfNeeded(modelId)}${suffix}`,
  );
  out = out.replace(
    /( - Assistant knowledge cutoff is )([^.]+)(\.)/g,
    (_, prefix, cutoff, suffix) => `${prefix}${wrapIfNeeded(cutoff)}${suffix}`,
  );
  out = out.replace(
    /(Status:\n)([\s\S]*?)(\n\nRecent commits:)/g,
    (_, prefix, status, suffix) => `${prefix}${harnessBlock(status.trimEnd())}${suffix}`,
  );
  out = out.replace(
    /(Recent commits:\n)([\s\S]*?)$/g,
    (_, prefix, commits) => `${prefix}${harnessBlock(commits.trimEnd())}`,
  );

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

function contentPartText(part) {
  if (typeof part === "string") return part;
  if (typeof part?.text === "string") return part.text;
  return "";
}

function messageText(body) {
  return (body.messages || [])
    .flatMap((message) => {
      const content = Array.isArray(message.content) ? message.content : [message.content];
      return content.map(contentPartText);
    })
    .filter(Boolean)
    .join("\n\n");
}

function markSteeringVariables(text) {
  let out = markHarnessVariables(text);

  out = out.replace(
    /<system-reminder>\nThe following deferred tools are now available[\s\S]*?<\/system-reminder>/g,
    (value) => harnessBlock(value),
  );
  out = out.replace(
    /<system-reminder>\nThe following skills are available[\s\S]*?<\/system-reminder>/g,
    (value) => harnessBlock(value),
  );
  out = out.replace(
    /The user's email address is ([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\./g,
    `The user's email address is ${harnessVariable("user@example.com")}.`,
  );
  out = out.replace(
    /Today's date is (\d{4}-\d{2}-\d{2})\./g,
    (_, value) => `Today's date is ${harnessVariable(value)}.`,
  );
  out = out.replace(
    /^(Reply exactly: .+)$/gm,
    (_, value) => harnessVariable(value),
  );

  return out;
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

function renderSteering(records) {
  const selected = selectPromptRecord(records);
  return `${markSteeringVariables(messageText(selected.body)).trimEnd()}\n`;
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
  const miscDir = path.join(outDir, "misc");
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.mkdirSync(miscDir, { recursive: true });
  removeMatchingFiles(promptsDir, (name) => name.endsWith("-interactive.md"));
  removeMatchingFiles(miscDir, (name) => name.endsWith("-interactive-steering.md"));

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
      path.join(promptsDir, `${safeFileName(model)}-interactive.md`),
      renderPrompt(modelRecords),
    );
    const steering = renderSteering(modelRecords);
    if (steering.trim()) {
      fs.writeFileSync(
        path.join(miscDir, `${safeFileName(model)}-interactive-steering.md`),
        steering,
      );
    }
  }

  const toolGroups = groupTools(agentRecords);
  for (const [name, variantsMap] of [...toolGroups.entries()].sort()) {
    const variants = [...variantsMap.values()].map((variant) => ({
      models: [...variant.models].sort(),
      trace_files: [...variant.trace_files].sort(),
      schema: variant.schema,
    }));
    mergeInteractiveTool(path.join(toolsDir, `${safeFileName(name)}.json`), name, variants);
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
  const promptFiles = fs.readdirSync(promptsDir).filter((entry) => entry.endsWith(".md")).sort();
  const miscFiles = fs.existsSync(miscDir)
    ? fs.readdirSync(miscDir).filter((entry) => entry.endsWith(".md")).sort()
    : [];
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
    "trace_script = claude-code/misc/scripts/trace-claude-messages.cjs",
    "extract_script = claude-code/misc/scripts/extract-claude-trace.cjs",
    "trace_source = local Bun preload /v1/messages trace (not stored)",
    "capture = tmux interactive session with `BUN_OPTIONS=--preload=claude-code/misc/scripts/trace-claude-messages.cjs claude --dangerously-skip-permissions --strict-mcp-config --tools default` and prompt `Reply exactly: CLAUDE_INTERACTIVE_TRACE_OK`",
    `prompt_models = ${modelNames.join(", ")}`,
    `prompts = ${promptFiles.length}`,
    `prompt_files = ${promptFiles.join(", ")}`,
    `misc_files = ${miscFiles.join(", ")}`,
    `tools = ${toolNames.length}`,
    `tool_names = ${toolNames.join(", ")}`,
  ];
  fs.writeFileSync(path.join(miscDir, "interactive-capture.VERSION"), `${versionLines.join("\n")}\n`);
}

main();
