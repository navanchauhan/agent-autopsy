#!/usr/bin/env node

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { writeSurfaceObservations } = require("../../../.github/scripts/surface-observations.cjs");

const MARKER = "Cortex API Request: ";
const DEFAULT_OUT_DIR = process.env.CAPTURE_SCRATCH_DIR
  ? path.resolve(process.env.CAPTURE_SCRATCH_DIR, "antigravity", "candidate")
  : path.resolve(process.cwd(), "antigravity");
const CAPTURE_WORKSPACE = process.env.AGY_CAPTURE_WORKSPACE || "";
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
    if (markerIndex !== -1) {
      const payload = line.slice(markerIndex + MARKER.length);
      requests.push({
        line: index + 1,
        payload: JSON.parse(payload),
      });
      continue;
    }

    if (!line.trimStart().startsWith("{")) continue;
    try {
      const record = JSON.parse(line);
      if (typeof record.request_body !== "string") continue;
      requests.push({
        line: index + 1,
        payload: JSON.parse(record.request_body),
        url: record.url,
        capture_marker: record.capture_marker,
        response_status: record.response_status,
        response_complete: record.response_complete,
        response_markers: record.response_markers,
        response_error: record.response_error,
        network_capture: true,
      });
    } catch {
      // Non-request verbose-log lines can begin with "{".
    }
  }
  return requests;
}

function safeFileName(name) {
  return name.replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function surfaceSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function resolveExecutable(command) {
  const candidates = [];
  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    candidates.push(path.resolve(command));
  } else {
    const extensions =
      process.platform === "win32"
        ? ["", ...(process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")]
        : [""];
    for (const directory of (process.env.PATH || "").split(path.delimiter)) {
      if (!directory) continue;
      for (const extension of extensions) {
        candidates.push(path.join(directory, `${command}${extension}`));
      }
    }
  }
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
    } catch {
      // Continue searching PATH.
    }
  }
  return "unknown";
}

function execFileOrUnknown(command, args) {
  if (command === "unknown") return "unknown";
  try {
    return childProcess
      .execFileSync(command, args, { encoding: "utf8", timeout: 10_000 })
      .trim();
  } catch {
    return "unknown";
  }
}

function readPinnedAntigravityPlan() {
  const planPath =
    process.env.CHANGED_TOOLS_FILE ||
    path.join(
      process.env.CAPTURE_SCRATCH_DIR || path.resolve(process.cwd(), ".capture-scratch"),
      "changed-tools.json",
    );

  const resolved = path.resolve(planPath);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new Error(
      `Pinned Antigravity capture plan is unavailable at ${resolved}; run the release resolver first`,
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 1024 * 1024) {
    throw new Error("CHANGED_TOOLS_FILE must be a nonempty regular JSON file no larger than 1 MiB");
  }
  const plan = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (!Array.isArray(plan)) throw new Error("CHANGED_TOOLS_FILE must contain a capture-plan array");
  const matches = plan.filter((entry) => entry?.tool === "antigravity");
  if (matches.length !== 1) {
    throw new Error("The capture plan must contain exactly one Antigravity entry");
  }

  const entry = matches[0];
  if (
    typeof entry.new_version !== "string" ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][A-Za-z0-9.]+)?$/.test(entry.new_version)
  ) {
    throw new Error("The Antigravity capture plan has an invalid target version");
  }
  if (typeof entry.artifact_url !== "string") {
    throw new Error("The Antigravity capture plan is missing its artifact URL");
  }
  let artifactUrl;
  try {
    artifactUrl = new URL(entry.artifact_url);
  } catch {
    throw new Error("The Antigravity capture plan has an invalid artifact URL");
  }
  if (artifactUrl.protocol !== "https:") {
    throw new Error("The Antigravity capture artifact URL must use HTTPS");
  }
  if (
    typeof entry.artifact_sha512 !== "string" ||
    !/^[0-9a-f]{128}$/.test(entry.artifact_sha512)
  ) {
    throw new Error("The Antigravity capture plan has an invalid artifact SHA-512");
  }
  return entry;
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
  let out = value;
  if (CAPTURE_WORKSPACE) {
    out = replaceAllLiteral(
      out,
      CAPTURE_WORKSPACE,
      "/Users/example/Developer/example-repo",
    );
  }
  return out
    .replace(/\/Users\/[^/\s<>"')\]]+\/Developer\/[^\s<>"')\]]+/g, "/Users/example/Developer/example-repo")
    .replace(/\/Users\/[^/]+\/\.gemini\/antigravity-cli/g, "/Users/example/.gemini/antigravity-cli")
    .replace(/\/home\/[^/]+\/\.gemini\/antigravity-cli/g, "/Users/example/.gemini/antigravity-cli")
    .replace(/^\/workspace$/, "/Users/example/Developer/example-repo")
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
  if (CAPTURE_WORKSPACE) {
    out = replaceAllLiteral(
      out,
      CAPTURE_WORKSPACE,
      harnessScalar("workspaceUri", "/Users/example/Developer/example-repo"),
    );
  }
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

function selectPromptRecord(records, captureMode) {
  const marker =
    captureMode === "interactive"
      ? "ANTIGRAVITY_INTERACTIVE_TRACE_OK"
      : "ANTIGRAVITY_TRACE_OK";
  const traceRecords = records.filter((record) =>
    requestText(record.payload.request).includes(marker),
  );
  return traceRecords.at(-1) || records.at(-1);
}

function renderPrompt(model, records, captureMode) {
  const selected = selectPromptRecord(records, captureMode);
  return `${markHarnessVariables(requestText(selected.payload.request)).trimEnd()}\n`;
}

function groupTools(records) {
  const groups = new Map();

  for (const record of records) {
    const model = record.payload.model;
    const requestKind = record.payload.requestType;
    for (const tool of record.payload.request.tools || []) {
      const normalizedTool = JSON.parse(JSON.stringify(tool));
      for (const declaration of normalizedTool.functionDeclarations || []) {
        declaration.description = declaration.description?.replace(
          /Operating System: ([^.]+)\. Shell: ([^.]+)\./,
          (_, os, shell) =>
            `Operating System: ${harnessScalar("userOsVersion", sanitizeExample(os))}. Shell: ${harnessScalar("userShell", sanitizeExample(shell))}.`,
        );
      }
      const declarations = normalizedTool.functionDeclarations || [];
      if (declarations.length !== 1) {
        throw new Error(
          `Expected exactly one functionDeclaration per tool wrapper on line ${record.line}`,
        );
      }

      const name = declarations[0].name;
      if (!groups.has(name)) groups.set(name, new Map());
      const variants = groups.get(name);
      const signature = JSON.stringify(normalizedTool);
      if (!variants.has(signature)) {
        variants.set(signature, {
          models: new Set(),
          request_kinds: new Set(),
          schema: normalizedTool,
        });
      }
      const variant = variants.get(signature);
      variant.models.add(model);
      variant.request_kinds.add(requestKind);
    }
  }

  return groups;
}

function mergeInteractiveTool(toolPath, name, interactiveVariants) {
  const incoming = interactiveVariants.map((variant) => ({
    capture_modes: ["interactive"],
    models: variant.models,
    request_kinds: variant.request_kinds,
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
    for (const next of incoming) {
      const match = existing.variants.find((variant) => sameJson(variant.schema, next.schema));
      if (match) {
        mergeList(match, "capture_modes", next.capture_modes);
        mergeList(match, "models", next.models);
        mergeList(match, "request_kinds", next.request_kinds);
      } else {
        existing.variants.push(next);
      }
    }
    writeJson(toolPath, existing);
    return;
  }

  if (existing.schema && incoming.length === 1 && sameJson(existing.schema, incoming[0].schema)) {
    delete existing.note;
    mergeList(existing, "capture_modes", ["non-interactive", "interactive"]);
    mergeList(existing, "models", incoming[0].models);
    mergeList(existing, "request_kinds", incoming[0].request_kinds);
    writeJson(toolPath, existing);
    return;
  }

  writeJson(toolPath, {
    name: existing.name || name,
    variants: [
      {
        capture_modes: ["non-interactive"],
        models: existing.models || [],
        request_kinds: existing.request_kinds || [],
        schema: existing.schema || existing,
      },
      ...incoming,
    ],
  });
}

function main() {
  const logPath = process.argv[2];
  if (!logPath) usage();
  const pinnedPlan = readPinnedAntigravityPlan();

  const logText = fs.readFileSync(logPath, "utf8");
  const metadataLogText =
    process.env.AGY_VERBOSE_LOG && fs.existsSync(process.env.AGY_VERBOSE_LOG)
      ? fs.readFileSync(process.env.AGY_VERBOSE_LOG, "utf8")
      : logText;
  const captureMode = process.env.AGY_CAPTURE_MODE === "interactive" ? "interactive" : "non-interactive";
  const expectedMarker =
    captureMode === "interactive"
      ? "ANTIGRAVITY_INTERACTIVE_TRACE_OK"
      : "ANTIGRAVITY_TRACE_OK";
  const outDir = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUT_DIR;
  let requests = readJsonRequests(logPath);
  const networkRequests = requests.filter((record) => record.network_capture);
  if (networkRequests.length > 0) {
    const completedRequests = networkRequests.filter(
      (record) =>
        Number.isInteger(record.response_status) &&
        record.response_status >= 200 &&
        record.response_status < 300 &&
        record.response_complete === true,
    );
    const completedMarker = completedRequests.some(
      (record) =>
        record.capture_marker === expectedMarker &&
        Array.isArray(record.response_markers) &&
        record.response_markers.includes(expectedMarker),
    );
    if (!completedMarker) {
      const evidence = networkRequests.map((record) => ({
        marker: record.capture_marker || null,
        status: record.response_status ?? null,
        complete: record.response_complete === true,
        responseMarkers: Array.isArray(record.response_markers)
          ? record.response_markers
          : [],
        error: record.response_error || null,
      }));
      throw new Error(
        `Missing completed successful ${captureMode} response marker ${expectedMarker}; evidence: ${JSON.stringify(evidence)}`,
      );
    }
    requests = completedRequests;
  }
  let agentRecords = requests.filter((record) => record.payload.requestType === "agent");
  if (agentRecords.length === 0) {
    throw new Error(`No agent Cortex API requests found in ${logPath}`);
  }
  if (networkRequests.length > 0) {
    const markerRecords = agentRecords.filter(
      (record) =>
        record.capture_marker === expectedMarker &&
        Array.isArray(record.response_markers) &&
        record.response_markers.includes(expectedMarker),
    );
    if (markerRecords.length === 0) {
      throw new Error(`Completed ${captureMode} marker was not an agent request`);
    }
    const usableMarkerRecords = markerRecords.filter((record) => {
      const systemPrompt = (record.payload.request?.systemInstruction?.parts || [])
        .map((part) => part.text || "")
        .join("")
        .trim();
      return (
        systemPrompt &&
        Array.isArray(record.payload.request?.tools) &&
        record.payload.request.tools.length > 0
      );
    });
    if (usableMarkerRecords.length === 0) {
      throw new Error(
        `Completed ${captureMode} capture omitted the system prompt or tool declarations`,
      );
    }
    const unusableMarkerRecords = new Set(
      markerRecords.filter((record) => !usableMarkerRecords.includes(record)),
    );
    agentRecords = agentRecords.filter((record) => !unusableMarkerRecords.has(record));
  }

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
      renderPrompt(model, records, captureMode),
    );
  }

  const toolGroups = groupTools(agentRecords);
  for (const [name, variantsMap] of [...toolGroups.entries()].sort()) {
    const variants = [...variantsMap.values()].map((variant) => ({
      models: [...variant.models].sort(),
      request_kinds: [...variant.request_kinds].sort(),
      schema: variant.schema,
    }));

    const value =
      variants.length === 1
        ? {
            name,
            models: variants[0].models,
            request_kinds: variants[0].request_kinds,
            schema: variants[0].schema,
          }
        : {
            name,
            variants,
          };

    const toolPath = path.join(toolsDir, `${safeFileName(name)}.json`);
    if (captureMode === "interactive") {
      mergeInteractiveTool(toolPath, name, variants);
    } else {
      writeJson(toolPath, value);
    }
  }

  const agyPath = resolveExecutable(
    process.env.AGY_CAPTURE_BINARY || process.env.ANTIGRAVITY_BIN || "agy",
  );
  const versionOutput = execFileOrUnknown(agyPath, ["--version"]);
  const installedVersion = versionOutput.match(/[0-9]+\.[0-9]+\.[0-9]+(?:[-.][A-Za-z0-9.]+)?/)?.[0];
  if (installedVersion !== pinnedPlan.new_version) {
    throw new Error(
      `Pinned Antigravity version mismatch: expected ${pinnedPlan.new_version}, found ${installedVersion || "unknown"}`,
    );
  }
  const version = pinnedPlan.new_version;
  const generatedAt = new Date().toISOString();
  const toolNames = [...toolGroups.keys()].sort();
  const modelNames = [...byModel.keys()].sort();
  const platform = `${process.platform}-${process.arch}`;
  const manifestPlatform =
    platform === "darwin-arm64"
      ? "darwin_arm64"
      : platform === "linux-x64"
        ? "linux_amd64"
        : null;
  const manifestUrl =
    manifestPlatform === null
      ? "unknown"
      : `https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/${manifestPlatform}.json`;
  const endpoint =
    requests.find((record) => record.url?.includes("streamGenerateContent"))?.url ||
    metadataLogText.match(/URL: (https:\/\/[^\s]+streamGenerateContent[^\s]*)/)?.[1] ||
    "unknown";
  const responseModelVersions = [
    ...new Set(
      [...metadataLogText.matchAll(/"modelVersion":\s*"([^"]+)"/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort();
  const captureCommand = captureMode === "interactive" ? INTERACTIVE_TRACE_COMMAND : PRINT_TRACE_COMMAND;

  const versionLines = [
    "source = antigravity.google/cli",
    "distribution = native Go binary",
    `version = ${version}`,
    `platform = ${platform}`,
    `binary_path = ${displayPath(agyPath)}`,
    `sha256 = ${sha256File(agyPath)}`,
    `sha512 = ${sha512File(agyPath)}`,
    `installer_url = https://antigravity.google/cli/install.sh`,
    `manifest_url = ${manifestUrl}`,
    `manifest_version = ${pinnedPlan.new_version}`,
    `manifest_tarball_url = ${pinnedPlan.artifact_url}`,
    `manifest_tarball_sha512 = ${pinnedPlan.artifact_sha512}`,
    `generated_at = ${generatedAt}`,
    "auth_source = local Antigravity Google OAuth/keyring",
    "trace_script = antigravity/misc/scripts/extract-antigravity-log.cjs",
    "trace_source = local CODEIUM_VMODULE verbose agy.log (not stored)",
    `capture_mode = ${captureMode}`,
    `capture = ${captureCommand}`,
    `endpoint = ${endpoint}`,
    `response_model_versions = ${responseModelVersions.join(", ") || "unknown"}`,
    `prompt_models = ${modelNames.join(", ")}`,
    `prompts = ${modelNames.length}`,
    `tools = ${toolNames.length}`,
    "",
  ];
  if (captureMode === "interactive") {
    fs.writeFileSync(path.join(miscDir, "interactive-capture.VERSION"), versionLines.join("\n"));
  } else {
    fs.writeFileSync(path.join(outDir, "VERSION"), versionLines.join("\n"));
  }

  writeSurfaceObservations(
    path.resolve(
      process.env.CAPTURE_SURFACE_INVENTORY || path.join(outDir, "..", "surface-observations.json"),
    ),
    "antigravity",
    version,
    [
      ...modelNames.map((model) => ({
        id: `antigravity.prompt.agent.${surfaceSlug(model)}.${captureMode}`,
        category: "agent prompt",
        models: [model],
        modes: [captureMode],
        artifacts: [
          `prompts/${safeFileName(model)}${captureMode === "interactive" ? "-interactive" : ""}.md`,
        ],
      })),
      {
        id: "antigravity.tool.catalog",
        category: "tool schemas",
        models: modelNames,
        modes: [captureMode],
        artifacts: toolNames.map((name) => `tools/${safeFileName(name)}.json`),
      },
    ],
    { merge: captureMode === "interactive" },
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
