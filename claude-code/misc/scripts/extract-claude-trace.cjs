#!/usr/bin/env node

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_OUT_DIR = process.env.CAPTURE_SCRATCH_DIR
  ? path.resolve(process.env.CAPTURE_SCRATCH_DIR, "claude-code", "candidate")
  : path.resolve(process.cwd(), "claude-code");

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

function displayPath(filePath) {
  const home = process.env.HOME;
  return home && filePath.startsWith(home)
    ? filePath.replace(home, "/Users/example")
    : filePath;
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
    schema: variant.schema,
  }));

  if (!fs.existsSync(toolPath)) {
    writeJson(toolPath, {
      name,
      variants: incoming,
    });
    return;
  }

  const existing = JSON.parse(fs.readFileSync(toolPath, "utf8"));
  if (Array.isArray(existing.variants)) {
    delete existing.note;
    for (const variant of existing.variants) {
      if (!variant.capture_modes) variant.capture_modes = ["non-interactive"];
    }
    for (const next of incoming) {
      const match = existing.variants.find((variant) => sameJson(variant.schema, next.schema));
      if (match) {
        mergeList(match, "capture_modes", next.capture_modes);
        mergeList(match, "models", next.models);
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

function harnessScalar(name, example) {
  return `<harnessVariable>{{${name}=${example}}}</harnessVariable>`;
}

function replaceAllLiteral(text, search, replacement) {
  return text.split(search).join(replacement);
}

function firstMatch(text, regexp) {
  return text.match(regexp)?.[1] || "";
}

function scalarIfNeeded(name, value) {
  return value.includes("<harnessVariable>") ? value : harnessScalar(name, value);
}

function sanitizeExample(value) {
  return value
    .replace(/\/home\/[^/]+\/\.claude\/projects\/[^/\s<>"')\]]+\/memory\/?/g, "/Users/example/.claude/projects/-Users-example-Developer-example-repo/memory/")
    .replace(/\/home\/[^/]+\/\.local\/share\/claude\/versions\/[^/\s<>"')\]]+/g, "/Users/example/.local/share/claude/versions/2.1.148")
    .replace(/\/tmp\/claude-\d+\/[^/\s<>"')\]]+\/[0-9a-f-]{36}\/scratchpad/g, "/private/tmp/claude-501/-Users-example-Developer-example-repo/d7ebc0ce-22a2-4774-9fc2-8a69f496828b/scratchpad")
    .replace(/\/Users\/[^/]+\/\.claude\/projects\/[^/\s<>"')\]]+\/memory\/?/g, "/Users/example/.claude/projects/-Users-example-Developer-example-repo/memory/")
    .replace(/\/Users\/[^/]+\/Developer\/[^/\s<>"')\]]+/g, "/Users/example/Developer/example-repo")
    .replace(/\/Users\/[^/]+\/\.local\/share\/claude\/versions\/[^/\s<>"')\]]+/g, "/Users/example/.local/share/claude/versions/2.1.148")
    .replace(/\/private\/tmp\/claude-\d+\/-Users-[^/]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/scratchpad/g, "/private/tmp/claude-501/-Users-example-Developer-example-repo/d7ebc0ce-22a2-4774-9fc2-8a69f496828b/scratchpad")
    .replace(/\/Users\/[^/]+\//g, "/Users/example/")
    .replace(/^\/workspace$/, "/Users/example/Developer/example-repo")
    .replace(/\bcch=[^;]+;/g, "cch=00000;")
    .replace(/\bcc_prev_req=[^;\n]+;/g, "cc_prev_req=req_000000000000000000000000;");
}

function harnessScalarForValue(value, fallbackName = "runtimeValue") {
  const example = sanitizeExample(value);
  let name = fallbackName;
  if (/\bcc_version=[^;\n]+; cc_entrypoint=[^;\n]+; cch=[^;\n]+;(?: cc_prev_req=[^;\n]+;)?/.test(example)) {
    name = "anthropicBillingHeader";
  } else if (/\/\.claude\/projects\/.*\/memory\/?$/.test(example)) {
    name = "claudeProjectMemoryDirectory";
  } else if (/\/\.local\/share\/claude\/versions\//.test(example)) {
    name = "claudeBinaryPath";
  } else if (/^\/Users\/example\/Developer\/example-repo$/.test(example)) {
    name = fallbackName === "runtimeValue" ? "primaryWorkingDirectory" : fallbackName;
  } else if (/^\/Users\/example\//.test(example)) {
    name = "absolutePath";
  } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(example)) {
    name = "sessionId";
  }
  return harnessScalar(name, example);
}

const LINE_VARIABLE_NAMES = {
  " - Is a git repository": "isGitRepository",
  " - Platform": "platform",
  " - Shell": "shell",
  " - OS Version": "osVersion",
  "Current branch": "currentBranch",
  "Main branch (you will usually use this for PRs)": "mainBranch",
  "Git user": "gitUser",
};

function markLineValue(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`^(${escaped}: )([^\\n]+)$`, "gm"), (_, prefix, value) => {
    let example = sanitizeExample(value);
    if (label === "Current branch") example = "feature/example-branch";
    if (label === "Main branch (you will usually use this for PRs)") example = "default-branch";
    if (label === "Git user") example = "Example User";
    if (label.includes("date")) example = "2026-01-02";
    return `${prefix}${scalarIfNeeded(LINE_VARIABLE_NAMES[label] || "runtimeValue", example)}`;
  });
}

function markHarnessVariables(text) {
  let out = text;
  const literalExamples = new Map();
  const addLiteralExample = (value, name) => {
    if (value && !literalExamples.has(value)) literalExamples.set(value, name);
  };

  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?(?:Primary )?Working directory: (.+)$/m), "primaryWorkingDirectory");
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Primary working directory: (.+)$/m), "primaryWorkingDirectory");
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?OS Version: (.+)$/m), "osVersion");
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Today's date: (.+)$/m), "currentDate");
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Current date: (.+)$/m), "currentDate");
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Claude Code version: (.+)$/m), "claudeCodeVersion");
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Model: (.+)$/m), "modelId");
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Session ID: (.+)$/m), "sessionId");
  addLiteralExample(firstMatch(text, /^(?:\s*-\s*)?Memory directory: (.+)$/m), "claudeProjectMemoryDirectory");
  addLiteralExample(firstMatch(text, /^`(\/private\/tmp\/claude-\d+\/[^`]+\/scratchpad)`$/m), "scratchpadDirectory");

  for (const match of text.matchAll(/\/Users\/[^/]+\/[^\s<>"')\]]+/g)) {
    addLiteralExample(match[0], "absolutePath");
  }
  for (const match of text.matchAll(/\/home\/[^/]+\/\.claude\/projects\/[^/\s<>"')\]]+\/memory\/?/g)) {
    addLiteralExample(match[0], "claudeProjectMemoryDirectory");
  }
  for (const match of text.matchAll(/\/tmp\/claude-\d+\/[^/\s<>"')\]]+\/[0-9a-f-]{36}\/scratchpad/g)) {
    addLiteralExample(match[0], "scratchpadDirectory");
  }
  for (const match of text.matchAll(/\bcc_version=[^;\n]+; cc_entrypoint=[^;\n]+; cch=[^;\n]+;(?: cc_prev_req=[^;\n]+;)?/g)) {
    addLiteralExample(match[0], "anthropicBillingHeader");
  }
  for (const match of text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)) {
    addLiteralExample(match[0], "sessionId");
  }

  for (const [value, name] of [...literalExamples.entries()].sort((a, b) => b[0].length - a[0].length)) {
    out = replaceAllLiteral(out, value, harnessScalarForValue(value, name));
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
      `${prefix}${scalarIfNeeded("modelDisplayName", modelName)}${middle}${scalarIfNeeded("modelId", modelId)}${suffix}`,
  );
  out = out.replace(
    /( - Assistant knowledge cutoff is )([^.]+)(\.)/g,
    (_, prefix, cutoff, suffix) => `${prefix}${scalarIfNeeded("knowledgeCutoff", cutoff)}${suffix}`,
  );
  out = out.replace(
    /(Status:\n)([\s\S]*?)(\n\nRecent commits:)/g,
    (_, prefix, _status, suffix) =>
      `${prefix}<harnessVariable>\n{{#each gitStatusEntries}}\n{{status}} {{path}}\n{{/each}}\n\nExample:\nM src/example.ts\n?? docs/example.md\n</harnessVariable>${suffix}`,
  );
  out = out.replace(
    /(Recent commits:\n)([\s\S]*?)$/g,
    (_, prefix, _commits) =>
      `${prefix}<harnessVariable>\n{{#each recentCommits}}\n{{shortSha}} {{subject}}\n{{/each}}\n\nExample:\nabc1234 Add example feature\ndef5678 Initial commit\n</harnessVariable>`,
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

const DEFERRED_TOOLS_STEERING_HARNESS = `<harnessVariable>
<system-reminder>
The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:
{{#each deferredTools}}
{{name}}
{{/each}}

Example:
Read
Edit
</system-reminder>
</harnessVariable>`;

const AVAILABLE_SKILLS_STEERING_HARNESS = `<harnessVariable>
<system-reminder>
The following skills are available for use with the Skill tool:

{{#each availableSkills}}
- {{name}}: {{description}}
{{/each}}

Example:
- example-skill: Example user-installed skill description.
</system-reminder>
</harnessVariable>`;

function markSteeringVariables(text) {
  let out = markHarnessVariables(text);

  out = out.replace(
    /<system-reminder>\nThe following deferred tools are now available[\s\S]*?<\/system-reminder>/g,
    () => DEFERRED_TOOLS_STEERING_HARNESS,
  );
  out = out.replace(
    /<system-reminder>\nThe following skills are available[\s\S]*?<\/system-reminder>/g,
    () => AVAILABLE_SKILLS_STEERING_HARNESS,
  );
  out = out.replace(
    /The user's email address is ([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\./g,
    `The user's email address is ${harnessScalar("userEmail", "user@example.com")}.`,
  );
  out = out.replace(
    /Today's date is (\d{4}-\d{2}-\d{2})\./g,
    () => `Today's date is ${harnessScalar("currentDate", "2026-01-02")}.`,
  );
  out = out.replace(
    /^(Reply exactly: .+)$/gm,
    (_, value) => harnessScalar("userRequest", value),
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
          schema: tool,
        });
      }
      const variant = variants.get(signature);
      variant.models.add(model);
    }
  }
  return groups;
}

function main() {
  const traceDir = process.argv[2] ? path.resolve(process.argv[2]) : "";
  if (!traceDir) usage();

  const outDir = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUT_DIR;
  const records = readRecords(traceDir).filter((record) => systemText(record.body));
  if (records.length === 0) {
    throw new Error(`No Claude /v1/messages records with system prompts found in ${traceDir}`);
  }

  const promptsDir = path.join(outDir, "prompts");
  const toolsDir = path.join(outDir, "tools");
  const miscDir = path.join(outDir, "misc");
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.mkdirSync(miscDir, { recursive: true });
  removeMatchingFiles(promptsDir, (name) => name.endsWith("-interactive.md"));
  removeMatchingFiles(miscDir, (name) => name.endsWith("-interactive-steering.md"));

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
  const capturedBinaryPath = path.join(
    process.env.HOME || "",
    ".local",
    "share",
    "claude",
    "versions",
    capturedVersion,
  );
  const binaryPath = fs.existsSync(capturedBinaryPath) ? capturedBinaryPath : claudePath;
  const modelNames = [...byModel.keys()].sort();
  const toolNames = [...toolGroups.keys()].sort();
  const promptFiles = fs.readdirSync(promptsDir).filter((entry) => entry.endsWith(".md")).sort();
  const versionLines = [
    "source = anthropic-ai/claude-code",
    "distribution = native Bun binary",
    `version = ${capturedVersion}`,
    `installed_version_at_extract = ${installedVersion}`,
    `platform = ${process.platform}-${process.arch}`,
    `binary_path = ${displayPath(binaryPath)}`,
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
    `tools = ${toolNames.length}`,
  ];
  fs.writeFileSync(path.join(miscDir, "interactive-capture.VERSION"), `${versionLines.join("\n")}\n`);
}

main();
