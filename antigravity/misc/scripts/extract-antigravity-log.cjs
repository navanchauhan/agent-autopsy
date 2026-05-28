#!/usr/bin/env node

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MARKER = "Cortex API Request: ";
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), "antigravity");
const PRINT_TRACE_COMMAND =
  "CODEIUM_VMODULE='*=5' agy --add-dir \"$PWD\" --print 'Reply exactly: ANTIGRAVITY_TRACE_OK' --print-timeout 90s --log-file <trace>/agy.log";
const INTERACTIVE_TRACE_COMMAND =
  "tmux new-session with `CODEIUM_VMODULE='*=5' agy --add-dir \"$PWD\" --dangerously-skip-permissions --log-file <trace>/agy.log`, then send `Reply exactly: ANTIGRAVITY_INTERACTIVE_TRACE_OK`";

function usage() {
  console.error(
    "Usage: node antigravity/misc/scripts/extract-antigravity-log.cjs <agy.log> [out-dir]",
  );
  process.exit(2);
}

function readJsonRequests(logPath) {
  const lines = fs.readFileSync(logPath, "utf8").split("\n");
  const requests = [];
  for (const [index, line] of lines.entries()) {
    const markerIndex = line.indexOf(MARKER);
    if (markerIndex === -1) continue;

    const payload = line.slice(markerIndex + MARKER.length);
    requests.push({
      line: index + 1,
      payload: JSON.parse(payload),
    });
  }
  return requests;
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

function fetchJsonOrNull(url) {
  try {
    return JSON.parse(childProcess.execFileSync("curl", ["-fsSL", url], { encoding: "utf8" }));
  } catch {
    return null;
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

function sha512File(filePath) {
  try {
    const hash = crypto.createHash("sha512");
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

function harnessScalar(name, example) {
  return `<harnessVariable>{{${name}=${example}}}</harnessVariable>`;
}

function replaceAllLiteral(text, search, replacement) {
  return text.split(search).join(replacement);
}

function firstMatch(text, regexp) {
  return text.match(regexp)?.[1] || "";
}

function sanitizeExample(value) {
  return value
    .replace(/\/Users\/[^/]+\/Developer\/[^/\s<>"')\]]+/g, "/Users/example/Developer/example-repo")
    .replace(/\/Users\/[^/]+\/\.gemini\/antigravity-cli/g, "/Users/example/.gemini/antigravity-cli")
    .replace(/\/Users\/[^/]+\//g, "/Users/example/")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "00000000-0000-4000-8000-000000000000")
    .replace(/\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[-+]\d{2}:\d{2})\b/g, "2026-01-02T15:04:05-07:00")
    .replace(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "example-org/example-repo");
}

function harnessScalarForValue(value, fallbackName = "runtimeValue") {
  const example = sanitizeExample(value);
  let name = fallbackName;
  if (example === "example-org/example-repo") name = "corpusName";
  else if (/^\/Users\/example\/Developer\/example-repo/.test(example)) name = "workspaceUri";
  else if (/^\/Users\/example\/\.gemini\/antigravity-cli$/.test(example)) name = "antigravityAppDataDirectory";
  else if (/^\/Users\/example\//.test(example)) name = "absolutePath";
  else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(example)) name = "conversationId";
  else if (/^20\d{2}-\d{2}-\d{2}T/.test(example)) name = "currentLocalTime";
  return harnessScalar(name, example);
}

function markHarnessVariables(text) {
  let out = text;
  const literalExamples = new Map();
  const addLiteralExample = (value, name) => {
    if (value && !literalExamples.has(value)) literalExamples.set(value, name);
  };

  const appDataDir = firstMatch(text, /^App Data Directory: (.+)$/m);
  const conversationId =
    firstMatch(
      text,
      /^Conversation ID: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/im,
    ) ||
    firstMatch(
      text,
      /\/brain\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i,
    );
  const userRequest = firstMatch(text, /<USER_REQUEST>\n([\s\S]*?)\n<\/USER_REQUEST>/);
  const localTime = firstMatch(text, /The current local time is: ([^.]+)\./);
  const osVersion = firstMatch(text, /The USER's OS version is ([^.]+)\./);
  const activeWorkspaceCount = firstMatch(text, /The user has (\d+) active workspaces/);
  const modelSettingChange = text.match(
    /^The user changed setting `Model Selection` from (.+) to (.+)\. No need/m,
  );

  addLiteralExample(appDataDir, "antigravityAppDataDirectory");
  addLiteralExample(conversationId, "conversationId");
  addLiteralExample(userRequest, "userRequest");
  addLiteralExample(localTime, "currentLocalTime");

  for (const match of text.matchAll(/^(.+) -> (.+)$/gm)) {
    if (match[1].startsWith("/")) {
      addLiteralExample(match[1], "workspaceUri");
      addLiteralExample(match[2], "corpusName");
    }
  }

  for (const [value, name] of [...literalExamples.entries()].sort((a, b) => b[0].length - a[0].length)) {
    out = replaceAllLiteral(out, value, harnessScalarForValue(value, name));
  }

  if (osVersion) {
    out = out.replace(
      /The USER's OS version is [^.]+\./g,
      `The USER's OS version is ${harnessScalar("userOsVersion", sanitizeExample(osVersion))}.`,
    );
  }
  if (activeWorkspaceCount) {
    out = out.replace(
      /The user has \d+ active workspaces/g,
      `The user has ${harnessScalar("activeWorkspaceCount", activeWorkspaceCount)} active workspaces`,
    );
  }
  if (modelSettingChange) {
    out = replaceAllLiteral(
      out,
      `from ${modelSettingChange[1]} to ${modelSettingChange[2]}`,
      `from ${harnessScalarForValue(modelSettingChange[1], "previousModelSelection")} to ${harnessScalarForValue(modelSettingChange[2], "newModelSelection")}`,
    );
  }

  if (appDataDir) {
    out = replaceAllLiteral(out, "<appDataDir>", harnessScalarForValue(appDataDir, "antigravityAppDataDirectory"));
  }
  if (conversationId) {
    out = replaceAllLiteral(
      out,
      "<conversation-id>",
      harnessScalarForValue(conversationId, "conversationId"),
    );
  }

  return out;
}

function requestText(req) {
  const out = [];
  for (const part of req.systemInstruction?.parts || []) out.push(part.text || "");
  for (const content of req.contents || []) {
    for (const part of content.parts || []) out.push(part.text || "");
  }
  return out.join("\n\n");
}

function selectPromptRecord(records) {
  const traceRecords = records.filter((record) =>
    /ANTIGRAVITY.*TRACE_OK/.test(requestText(record.payload.request)),
  );
  return traceRecords.at(-1) || records.at(-1);
}

function renderPrompt(model, records) {
  const selected = selectPromptRecord(records);
  return `${markHarnessVariables(requestText(selected.payload.request)).trimEnd()}\n`;
}

function groupTools(records) {
  const groups = new Map();

  for (const record of records) {
    const model = record.payload.model;
    const requestKind = record.payload.requestType;
    for (const tool of record.payload.request.tools || []) {
      const declarations = tool.functionDeclarations || [];
      if (declarations.length !== 1) {
        throw new Error(
          `Expected exactly one functionDeclaration per tool wrapper on line ${record.line}`,
        );
      }

      const name = declarations[0].name;
      if (!groups.has(name)) groups.set(name, new Map());
      const variants = groups.get(name);
      const signature = JSON.stringify(tool);
      if (!variants.has(signature)) {
        variants.set(signature, {
          models: new Set(),
          request_kinds: new Set(),
          trace_lines: new Set(),
          schema: tool,
        });
      }
      const variant = variants.get(signature);
      variant.models.add(model);
      variant.request_kinds.add(requestKind);
      variant.trace_lines.add(record.line);
    }
  }

  return groups;
}

function mergeInteractiveTool(toolPath, name, interactiveVariants) {
  const incoming = interactiveVariants.map((variant) => ({
    capture_modes: ["interactive"],
    models: variant.models,
    request_kinds: variant.request_kinds,
    trace_lines: variant.trace_lines,
    schema: variant.schema,
  }));

  if (!fs.existsSync(toolPath)) {
    writeJson(toolPath, {
      name,
      note:
        "This function declaration was observed in an interactive Antigravity agent request. Each variant schema is the exact request.tools[] wrapper.",
      variants: incoming,
    });
    return;
  }

  const existing = JSON.parse(fs.readFileSync(toolPath, "utf8"));
  if (Array.isArray(existing.variants)) {
    for (const next of incoming) {
      const match = existing.variants.find((variant) => sameJson(variant.schema, next.schema));
      if (match) {
        mergeList(match, "capture_modes", next.capture_modes);
        mergeList(match, "models", next.models);
        mergeList(match, "request_kinds", next.request_kinds);
        mergeList(match, "trace_lines", next.trace_lines);
      } else {
        existing.variants.push(next);
      }
    }
    writeJson(toolPath, existing);
    return;
  }

  if (existing.schema && incoming.length === 1 && sameJson(existing.schema, incoming[0].schema)) {
    existing.note =
      "The schema field is the exact request.tools[] entry sent for this function declaration in the traced Antigravity agent request. The same schema was observed in each listed capture mode.";
    mergeList(existing, "capture_modes", ["non-interactive", "interactive"]);
    mergeList(existing, "models", incoming[0].models);
    mergeList(existing, "request_kinds", incoming[0].request_kinds);
    mergeList(existing, "trace_lines", incoming[0].trace_lines);
    writeJson(toolPath, existing);
    return;
  }

  writeJson(toolPath, {
    name: existing.name || name,
    note:
      "This function declaration had different exact request.tools[] payloads across capture modes. Each variant schema is the exact wrapper sent for that capture mode.",
    variants: [
      {
        capture_modes: ["non-interactive"],
        models: existing.models || [],
        request_kinds: existing.request_kinds || [],
        trace_lines: existing.trace_lines || [],
        schema: existing.schema || existing,
      },
      ...incoming,
    ],
  });
}

function main() {
  const logPath = process.argv[2];
  if (!logPath) usage();

  const logText = fs.readFileSync(logPath, "utf8");
  const captureMode = process.env.AGY_CAPTURE_MODE === "interactive" ? "interactive" : "non-interactive";
  const outDir = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUT_DIR;
  const promptsDir = path.join(outDir, "prompts");
  const toolsDir = path.join(outDir, "tools");
  const miscDir = path.join(outDir, "misc");
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.mkdirSync(miscDir, { recursive: true });
  if (captureMode === "interactive") {
    removeMatchingFiles(promptsDir, (name) => name.endsWith("-interactive.md"));
  } else {
    removeGeneratedFiles(promptsDir, ".md");
    removeGeneratedFiles(toolsDir, ".json");
  }

  const requests = readJsonRequests(logPath);
  const agentRecords = requests.filter((record) => record.payload.requestType === "agent");
  if (agentRecords.length === 0) {
    throw new Error(`No agent Cortex API requests found in ${logPath}`);
  }

  const byModel = new Map();
  for (const record of agentRecords) {
    const model = record.payload.model;
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model).push(record);
  }

  for (const [model, records] of byModel.entries()) {
    fs.writeFileSync(
      path.join(
        promptsDir,
        captureMode === "interactive"
          ? `${safeFileName(model)}-interactive.md`
          : `${safeFileName(model)}.md`,
      ),
      renderPrompt(model, records),
    );
  }

  const toolGroups = groupTools(agentRecords);
  for (const [name, variantsMap] of [...toolGroups.entries()].sort()) {
    const variants = [...variantsMap.values()].map((variant) => ({
      models: [...variant.models].sort(),
      request_kinds: [...variant.request_kinds].sort(),
      trace_lines: [...variant.trace_lines].sort((a, b) => a - b),
      schema: variant.schema,
    }));

    const value =
      variants.length === 1
        ? {
            name,
            note:
              "The schema field is the exact request.tools[] entry sent for this function declaration in the traced Antigravity agent request.",
            models: variants[0].models,
            request_kinds: variants[0].request_kinds,
            trace_lines: variants[0].trace_lines,
            schema: variants[0].schema,
          }
        : {
            name,
            note:
              "This tool had different exact request.tools[] payloads across traced Antigravity agent requests. Each variant schema is exact.",
            variants,
          };

    const toolPath = path.join(toolsDir, `${safeFileName(name)}.json`);
    if (captureMode === "interactive") {
      mergeInteractiveTool(toolPath, name, variants);
    } else {
      writeJson(toolPath, value);
    }
  }

  const agyPath = execOrUnknown("command -v agy");
  const version = execOrUnknown("agy --version");
  const generatedAt = new Date().toISOString();
  const toolNames = [...toolGroups.keys()].sort();
  const modelNames = [...byModel.keys()].sort();
  const manifestUrl =
    "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/darwin_arm64.json";
  const manifest =
    fetchJsonOrNull(manifestUrl) || {
      version: "1.0.2",
      url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.0.2-6109799369277440/darwin-arm/cli_mac_arm64.tar.gz",
      sha512:
        "9e177599230ed22605879b8e96f4ba9b8d8bab98586fedae14dae4536bf75529c7e0c7a6dee4134c913927c8b02fbb212e6fc81bcf982d06d6850663eb3fbfe0",
    };
  const selectedModelLabel =
    logText.match(/display_name:"([^"]+)"/)?.[1] ||
    logText.match(/label="([^"]+)"/)?.[1] ||
    "unknown";
  const endpoint =
    logText.match(/URL: (https:\/\/[^\s]+streamGenerateContent[^\s]*)/)?.[1] ||
    "unknown";
  const responseModelVersions = [
    ...new Set([...logText.matchAll(/"modelVersion":\s*"([^"]+)"/g)].map((m) => m[1])),
  ].sort();
  const captureCommand = captureMode === "interactive" ? INTERACTIVE_TRACE_COMMAND : PRINT_TRACE_COMMAND;

  const versionLines = [
    "source = antigravity.google/cli",
    "distribution = native Go binary",
    `version = ${version}`,
    "platform = darwin-arm64",
    `binary_path = ${displayPath(agyPath)}`,
    `sha256 = ${sha256File(agyPath)}`,
    `sha512 = ${sha512File(agyPath)}`,
    `installer_url = https://antigravity.google/cli/install.sh`,
    `manifest_url = ${manifestUrl}`,
    `manifest_version = ${manifest.version || "unknown"}`,
    `manifest_tarball_url = ${manifest.url || "unknown"}`,
    `manifest_tarball_sha512 = ${manifest.sha512 || "unknown"}`,
    `generated_at = ${generatedAt}`,
    "auth_source = local Antigravity Google OAuth/keyring",
    "trace_script = antigravity/misc/scripts/extract-antigravity-log.cjs",
    "trace_source = local CODEIUM_VMODULE verbose agy.log (not stored)",
    `capture_mode = ${captureMode}`,
    `capture = ${captureCommand}`,
    `endpoint = ${endpoint}`,
    `selected_model_label = ${selectedModelLabel}`,
    `response_model_versions = ${responseModelVersions.join(", ") || "unknown"}`,
    `prompt_models = ${modelNames.join(", ")}`,
    `prompts = ${modelNames.length}`,
    `tools = ${toolNames.length}`,
    `tool_names = ${toolNames.join(", ")}`,
    "tool_notes = Antigravity sends Gemini function declarations inside request.tools[]; each tool file stores the exact request.tools[] wrapper observed for that function in the agent request.",
    "",
  ];
  if (captureMode === "interactive") {
    fs.writeFileSync(path.join(miscDir, "interactive-capture.VERSION"), versionLines.join("\n"));
  } else {
    fs.writeFileSync(path.join(outDir, "VERSION"), versionLines.join("\n"));

    fs.writeFileSync(
      path.join(outDir, "README.md"),
      `# Antigravity CLI\n\nAntigravity CLI is Google's coding agent. These artifacts were extracted from the installed \`agy\` binary by enabling verbose \`CODEIUM_VMODULE='*=5'\` logging and parsing the real \`Cortex API Request\` payload sent to \`streamGenerateContent\`.\n\n- \`prompts/\` contains raw captured prompt text grouped by model. Run-specific scalar values are marked with \`<harnessVariable>{{name=example}}</harnessVariable>\`; repeated runtime sections use \`{{#each collectionName}}...{{/each}}\` blocks inside \`<harnessVariable>...</harnessVariable>\`.\n- \`tools/\` contains one JSON file per observed Gemini function declaration. The nested \`schema\` is the exact \`request.tools[]\` wrapper sent for that function. Files may contain \`variants[]\` when capture modes differ.\n- \`misc/\` contains support scripts and capture side artifacts.\n- \`VERSION\` records the Antigravity CLI version, install manifest, binary checksums, capture command, and model/tool counts.\n\nRun a fresh non-interactive capture with:\n\n\`\`\`sh\ntrace_dir=$(mktemp -d /tmp/agy-trace.XXXXXX)\nCODEIUM_VMODULE='*=5' agy --add-dir \"$PWD\" --print 'Reply exactly: ANTIGRAVITY_TRACE_OK' --print-timeout 90s --log-file \"$trace_dir/agy.log\"\nnode antigravity/misc/scripts/extract-antigravity-log.cjs \"$trace_dir/agy.log\"\n\`\`\`\n\nRun a fresh interactive capture with:\n\n\`\`\`sh\ntrace_dir=$(mktemp -d /tmp/agy-interactive.XXXXXX)\ntmux new-session -d -s agy-trace \"cd $PWD && CODEIUM_VMODULE='*=5' agy --add-dir \\\"$PWD\\\" --dangerously-skip-permissions --log-file \\\"$trace_dir/agy.log\\\"\"\ntmux send-keys -t agy-trace 'Reply exactly: ANTIGRAVITY_INTERACTIVE_TRACE_OK' Enter\nAGY_CAPTURE_MODE=interactive node antigravity/misc/scripts/extract-antigravity-log.cjs \"$trace_dir/agy.log\"\n\`\`\`\n`,
    );
  }

  console.log(
    JSON.stringify(
      {
        log: path.resolve(logPath),
        outDir,
        models: modelNames,
        prompts: modelNames.length,
        tools: toolNames.length,
      },
      null,
      2,
    ),
  );
}

main();
