#!/usr/bin/env node

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MARKER = "Cortex API Request: ";
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), "antigravity");
const TRACE_COMMAND =
  "CODEIUM_VMODULE='*=5' agy --add-dir \"$PWD\" --print 'Reply exactly: ANTIGRAVITY_TRACE_OK' --print-timeout 90s --log-file <trace>/agy.log";

function usage() {
  console.error(
    "Usage: node antigravity/scripts/extract-antigravity-log.cjs <agy.log> [out-dir]",
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

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function renderPrompt(model, records) {
  const first = records[0];
  const req = first.payload.request;
  const system = req.systemInstruction || {};
  const parts = system.parts || [];
  const contentBlocks = req.contents || [];

  const out = [];
  out.push(`# ${model}`);
  out.push("");
  out.push(
    "Source: Antigravity CLI verbose `Cortex API Request` trace captured from the real `streamGenerateContent` request.",
  );
  out.push(`Request type: ${first.payload.requestType}`);
  out.push(`Trace line: ${first.line}`);
  out.push(`Tool mode: ${req.toolConfig?.functionCallingConfig?.mode || "unknown"}`);
  out.push("");
  out.push("## systemInstruction");
  out.push("");
  out.push(
    "The blocks below are the exact `request.systemInstruction.parts[]` text entries in order.",
  );

  for (const [index, part] of parts.entries()) {
    const metadata = { ...part };
    delete metadata.text;
    out.push("");
    out.push(`### systemInstruction.parts[${index}]`);
    out.push("");
    out.push("```json");
    out.push(JSON.stringify(metadata, null, 2));
    out.push("```");
    out.push("");
    out.push("```text");
    out.push(part.text || "");
    out.push("```");
  }

  out.push("");
  out.push("## request contents");
  out.push("");
  out.push(
    "These are the non-tool text blocks observed in `request.contents[]` for the same agent request. They contain dynamic workspace, artifact, timestamp, and trace-user-request values.",
  );

  for (const [contentIndex, content] of contentBlocks.entries()) {
    for (const [partIndex, part] of (content.parts || []).entries()) {
      const metadata = { role: content.role, ...part };
      delete metadata.text;
      out.push("");
      out.push(`### contents[${contentIndex}].parts[${partIndex}]`);
      out.push("");
      out.push("```json");
      out.push(JSON.stringify(metadata, null, 2));
      out.push("```");
      out.push("");
      out.push("```text");
      out.push(part.text || "");
      out.push("```");
    }
  }

  return `${out.join("\n")}\n`;
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

function main() {
  const logPath = process.argv[2];
  if (!logPath) usage();

  const logText = fs.readFileSync(logPath, "utf8");
  const outDir = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUT_DIR;
  const promptsDir = path.join(outDir, "prompts");
  const toolsDir = path.join(outDir, "tools");
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });

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
      path.join(promptsDir, `${safeFileName(model)}.md`),
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

    writeJson(path.join(toolsDir, `${safeFileName(name)}.json`), value);
  }

  const agyPath = execOrUnknown("command -v agy");
  const version = execOrUnknown("agy --version");
  const generatedAt = new Date().toISOString();
  const toolNames = [...toolGroups.keys()].sort();
  const modelNames = [...byModel.keys()].sort();
  const manifestUrl =
    "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/darwin_arm64.json";
  const tarballUrl =
    "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.0.1-5826024320139264/darwin-arm/cli_mac_arm64.tar.gz";
  const manifestSha512 =
    "6e0bc8a8996680d06fb70cf6e52d3b8c0da06bceee97106c3d76726eaee8c94ec0385798ebc85fe0018088c94fe3cdd23fb61fbd39ec207ab958980c985d0ef0";
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

  const versionLines = [
    "source = antigravity.google/cli",
    "distribution = native Go binary",
    `version = ${version}`,
    "platform = darwin-arm64",
    `binary_path = ${agyPath}`,
    `sha256 = ${sha256File(agyPath)}`,
    `sha512 = ${sha512File(agyPath)}`,
    `installer_url = https://antigravity.google/cli/install.sh`,
    `manifest_url = ${manifestUrl}`,
    `manifest_version = 1.0.1`,
    `manifest_tarball_url = ${tarballUrl}`,
    `manifest_tarball_sha512 = ${manifestSha512}`,
    `generated_at = ${generatedAt}`,
    "auth_source = local Antigravity Google OAuth/keyring",
    "trace_script = antigravity/scripts/extract-antigravity-log.cjs",
    "trace_source = local CODEIUM_VMODULE verbose agy.log (not stored)",
    `capture = ${TRACE_COMMAND}`,
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
  fs.writeFileSync(path.join(outDir, "VERSION"), versionLines.join("\n"));

  fs.writeFileSync(
    path.join(outDir, "README.md"),
    `# Antigravity CLI\n\nAntigravity CLI is Google's coding agent. These artifacts were extracted from the installed \`agy\` binary by enabling verbose \`CODEIUM_VMODULE='*=5'\` logging and parsing the real \`Cortex API Request\` payload sent to \`streamGenerateContent\`.\n\n- \`prompts/\` contains captured \`systemInstruction\` prompt blocks and the observed request context blocks grouped by model.\n- \`tools/\` contains one JSON file per observed Gemini function declaration. The nested \`schema\` is the exact \`request.tools[]\` wrapper sent for that function.\n- \`VERSION\` records the Antigravity CLI version, install manifest, binary checksums, capture command, and model/tool counts.\n\nRun a fresh capture with:\n\n\`\`\`sh\ntrace_dir=$(mktemp -d /tmp/agy-trace.XXXXXX)\nCODEIUM_VMODULE='*=5' agy --add-dir \"$PWD\" --print 'Reply exactly: ANTIGRAVITY_TRACE_OK' --print-timeout 90s --log-file \"$trace_dir/agy.log\"\nnode antigravity/scripts/extract-antigravity-log.cjs \"$trace_dir/agy.log\"\n\`\`\`\n`,
  );

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
