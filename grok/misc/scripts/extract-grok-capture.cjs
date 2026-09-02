#!/usr/bin/env node

// Extracts prompts, steering, and exact tool variants from a redacted Grok capture.

const fs = require("fs");
const path = require("path");
const { writeSurfaceObservations } = require("../../../.github/scripts/surface-observations.cjs");

function usage() {
  console.error(
    "Usage: node grok/misc/scripts/extract-grok-capture.cjs <capture.jsonl> [out-dir=grok]",
  );
  process.exit(2);
}

const captureFile = process.argv[2];
const defaultOutDir = process.env.CAPTURE_SCRATCH_DIR
  ? path.resolve(process.env.CAPTURE_SCRATCH_DIR, "grok", "candidate")
  : "grok";
const outDir = path.resolve(process.argv[3] || defaultOutDir);
if (!captureFile) usage();

const HOME = process.env.HOME || "";

function readJsonl(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function surfaceSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function removeMatchingFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && predicate(entry.name)) fs.rmSync(path.join(dir, entry.name));
  }
}

// --- Templating helpers -----------------------------------------------

function genericizeHome(text) {
  let out = text;
  if (HOME) out = out.split(HOME).join("/Users/example");
  // Safety net: some paths embed the username in a slugified form that
  // doesn't literally match HOME (e.g. grok's per-project terminals dir,
  // built from a sanitized copy of the cwd). Strip any leftover username.
  const username = process.env.USER || (HOME ? path.basename(HOME) : null);
  if (username && username.length > 2) {
    out = out.split(username).join("example");
  }
  return out;
}

function wrap(name, example) {
  return `<harnessVariable>{{${name}=${example}}}</harnessVariable>`;
}

// Replace the exact captured values for well-known run-specific fields with
// <harnessVariable>{{name=example}}</harnessVariable> placeholders. `text`
// should already have had genericizeHome() applied.
function templateCommonFields(text, { cwd, date }) {
  let out = text;
  if (cwd) {
    const genericCwd = genericizeHome(cwd);
    out = out.split(genericCwd).join(wrap("workspacePath", "/Users/example/Developer/example-repo"));
  }
  if (date) {
    out = out.split(date).join(wrap("currentDate", "2026-01-02"));
  }
  out = out.replace(/OS Version: macos/g, `OS Version: ${wrap("osVersion", "macos")}`);
  out = out.replace(/OS Version: darwin [0-9.]+/g, `OS Version: ${wrap("osVersion", "darwin 25.5.0")}`);
  out = out.replace(/Shell: \/bin\/zsh/g, `Shell: ${wrap("shell", "/bin/zsh")}`);
  out = out.replace(/Today's date: Wednesday [A-Za-z]+ \d+, \d{4}/g, `Today's date: ${wrap("currentDateLong", "Wednesday Jan 2, 2026")}`);
  out = out.replace(/Is directory a git repo: (Yes|No)/g, `Is directory a git repo: ${wrap("isGitRepo", "No")}`);
  out = out.replace(
    /Terminals folder: .*/g,
    `Terminals folder: ${wrap("terminalsFolder", "/Users/example/.grok/projects/example-project/terminals")}`,
  );
  return out;
}

// Wrap a <user_query>...</user_query> block's inner text as a harnessVariable.
function templateUserQuery(text) {
  return text.replace(
    /<user_query>\n([\s\S]*?)\n<\/user_query>/,
    (_match, inner) => `<user_query>\n${wrap("userRequest", inner.trim())}\n</user_query>`,
  );
}

// Convert a captured "available skills" system-reminder listing (repeated
// "- name: description\n  Absolute path: path" entries) into a {{#each}}
// block, matching the convention used by claude-code/ampcode captures.
function templateSkillListing(text) {
  const marker = "The following skills are available for use";
  const idx = text.indexOf(marker);
  if (idx === -1) return text;
  const headerEnd = text.indexOf("\n", idx) + 1;
  const rest = text.slice(headerEnd);
  const entryRe = /^- ([^:]+): ([\s\S]*?)\n {2}Absolute path: (.*?)(?=\n(?:- |<\/system-reminder>|$))/gm;
  let match;
  let anyMatched = false;
  const templated = `{{#each availableSkills}}\n- {{name}}: {{description}}\n  Absolute path: {{path}}\n{{/each}}\n\nExample:\n- example-skill: Example user-installed skill description.\n  Absolute path: /Users/example/.grok/skills/example-skill/SKILL.md`;
  while ((match = entryRe.exec(rest)) !== null) {
    anyMatched = true;
  }
  if (!anyMatched) return text;
  // Replace the whole run of entries (from first "- " to the closing tag) with the template.
  const closeIdx = rest.indexOf("</system-reminder>");
  const before = text.slice(0, headerEnd);
  const after = closeIdx === -1 ? "" : rest.slice(closeIdx);
  return `${before}\n${wrap("__skillListing", "n/a").replace("__skillListing=n/a", "")}${templated}\n${after}`.replace(
    `${wrap("__skillListing", "n/a").replace("__skillListing=n/a", "")}`,
    "",
  );
}

// --- Load + classify captures -------------------------------------------

const records = readJsonl(captureFile);
const responsesRecords = records.filter(
  (r) =>
    typeof r.url === "string" &&
    /\/v1\/responses(?:\?|$)/.test(r.url) &&
    typeof r.request_body === "string",
);
if (responsesRecords.length === 0) {
  throw new Error(`No captured /v1/responses request bodies found in ${captureFile}`);
}

function successfulResponse(record) {
  return (
    Number.isInteger(record.response_status) &&
    record.response_status >= 200 &&
    record.response_status < 300 &&
    record.response_complete === true
  );
}

function hasResponseMarker(record, marker) {
  return (
    record.capture_marker === marker &&
    Array.isArray(record.response_markers) &&
    record.response_markers.includes(marker)
  );
}

function usableArtifactBody(body) {
  const hasSystemPrompt =
    Array.isArray(body.input) &&
    body.input.some(
      (message) =>
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.trim(),
    );
  return hasSystemPrompt && Array.isArray(body.tools) && body.tools.length > 0;
}

function classify(body, record) {
  const rawModel = typeof body.model === "string" ? body.model : "missing-model";
  const model = rawModel.replace(/[^A-Za-z0-9_.-]+/g, "_");
  const sysMsg = (body.input || []).find((m) => m.role === "system");
  const sysText = sysMsg && typeof sysMsg.content === "string" ? sysMsg.content : "";
  const toolNames = (body.tools || []).map((t) => t.name || t.type);

  if (toolNames.length === 1 && toolNames[0] === "session_title") {
    return "grok-session-title";
  }
  if (rawModel === "missing-model") return "unknown-missing-model";
  if (record.capture_marker === "GROK_INTERACTIVE_TRACE_OK") {
    return `${model}-interactive`;
  }
  if (record.capture_marker === "GROK_TRACE_OK") {
    return model;
  }
  if (model === "grok-composer-2.5-fast") {
    return model;
  }
  if (sysText.includes("You are an interactive CLI tool")) {
    return `${model}-interactive`;
  }
  if (sysText.includes("You are an autonomous agent")) {
    return model;
  }
  return `unknown-${model}`;
}

const byRunKind = new Map();
const allRunKinds = new Map();
for (const record of responsesRecords) {
  let body;
  try {
    body = JSON.parse(record.request_body);
  } catch {
    continue;
  }
  const runKind = classify(body, record);
  if (!allRunKinds.has(runKind)) allRunKinds.set(runKind, []);
  allRunKinds.get(runKind).push({ body, record });
  if (!successfulResponse(record) || !usableArtifactBody(body)) continue;
  if (!byRunKind.has(runKind)) byRunKind.set(runKind, []);
  const list = byRunKind.get(runKind);
  const cwdMatch = JSON.stringify(body.input).match(/Workspace Path: (.*?)\\n/);
  list.push({ body, cwd: cwdMatch ? cwdMatch[1] : null, record });
}
if (byRunKind.size === 0) {
  const statuses = responsesRecords.map((record) => record.response_status ?? "none");
  throw new Error(
    `No completed successful /v1/responses captures found in ${captureFile}; statuses: ${statuses.join(", ")}`,
  );
}

const unknownKinds = [...allRunKinds.keys()].filter((kind) => kind.startsWith("unknown-"));
if (unknownKinds.length > 0) {
  throw new Error(`Unclassified Grok capture kind(s): ${unknownKinds.join(", ")}`);
}

for (const marker of ["GROK_TRACE_OK", "GROK_INTERACTIVE_TRACE_OK"]) {
  const completed = [...byRunKind.values()]
    .flat()
    .filter(({ record }) => hasResponseMarker(record, marker));
  if (completed.length === 0) {
    const observed = responsesRecords
      .filter((record) => record.capture_marker === marker)
      .map((record) => record.response_status ?? "none")
      .join(", ");
    throw new Error(
      `Missing completed successful Grok response for ${marker}` +
        (observed ? `; observed statuses: ${observed}` : ""),
    );
  }
}

const completedSessionTitles = byRunKind.get("grok-session-title") || [];
if (completedSessionTitles.length === 0) {
  const observed = (allRunKinds.get("grok-session-title") || [])
    .map(({ record }) => record.response_status ?? "none")
    .join(", ");
  throw new Error(
    "Missing completed successful grok-session-title response" +
      (observed ? `; observed statuses: ${observed}` : ""),
  );
}

console.log("Run kinds found:", [...byRunKind.keys()].map((k) => `${k} (${byRunKind.get(k).length})`).join(", "));

// --- Write prompts/ + misc/ steering ------------------------------------

fs.mkdirSync(path.join(outDir, "prompts"), { recursive: true });
fs.mkdirSync(path.join(outDir, "misc"), { recursive: true });
removeMatchingFiles(path.join(outDir, "prompts"), (name) => name.endsWith(".md"));
removeMatchingFiles(path.join(outDir, "misc"), (name) => name.endsWith("-steering.md"));

function extractRunInfo(body) {
  const infoStr = JSON.stringify(body.input);
  const cwdMatch = infoStr.match(/Workspace Path: (.*?)\\n/);
  const dateMatch = infoStr.match(/Today's date: (\d{4}-\d{2}-\d{2})/);
  return {
    cwd: cwdMatch ? cwdMatch[1].replace(/\\\\/g, "\\") : null,
    date: dateMatch ? dateMatch[1] : null,
  };
}

const promptSurfaces = [];
const steeringEntries = [];
for (const [runKind, entries] of byRunKind) {
  const { body } = entries[entries.length - 1];
  const model = body.model;
  const mode = runKind === "grok-session-title"
    ? "session-title"
    : runKind.endsWith("-interactive") ? "interactive" : "non-interactive";
  const info = extractRunInfo(body);
  const messages = body.input || [];
  const systemMsg = messages.find((m) => m.role === "system");
  const otherMsgs = messages.filter((m) => m.role !== "system");

  if (systemMsg) {
    let systemText = genericizeHome(systemMsg.content);
    systemText = templateCommonFields(systemText, info);
    fs.writeFileSync(path.join(outDir, "prompts", `${runKind}.md`), `${systemText}\n`);
    promptSurfaces.push({
      id: mode === "session-title"
        ? "grok.prompt.special.session-title"
        : `grok.prompt.agent.${surfaceSlug(model)}.${mode}`,
      category: mode === "session-title" ? "session title prompt" : "agent prompt",
      models: [model],
      modes: [mode],
      artifacts: [`prompts/${runKind}.md`],
    });
  }

  // Skip emitting a steering file when the only non-system input is the bare
  // run-specific <user_query> wrapper with no durable/reusable content (e.g.
  // the session-title generator's second message) — nothing there is worth
  // capturing beyond the prompt file itself.
  const isBareUserQuery =
    otherMsgs.length === 1 &&
    typeof otherMsgs[0].content === "string" &&
    otherMsgs[0].content.trim().startsWith("<user_query>");

  if (otherMsgs.length > 0 && !isBareUserQuery) {
    let steering = otherMsgs
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n\n---\n\n");
    steering = genericizeHome(steering);
    steering = templateCommonFields(steering, info);
    steering = templateSkillListing(steering);
    steering = templateUserQuery(steering);
    fs.writeFileSync(path.join(outDir, "misc", `${runKind}-steering.md`), `${steering}\n`);
    steeringEntries.push({ model, mode, artifact: `misc/${runKind}-steering.md` });
  }
}

// --- Write tools/ ---------------------------------------------------------

fs.mkdirSync(path.join(outDir, "tools"), { recursive: true });
removeMatchingFiles(path.join(outDir, "tools"), (name) => name.endsWith(".json"));

// name -> [{ runKinds: Set, schema }]
const toolVariants = new Map();
for (const [runKind, entries] of byRunKind) {
  for (const { body } of entries) {
    for (const tool of body.tools || []) {
      const name = tool.name || tool.type;
      if (!name) continue;
      if (!toolVariants.has(name)) toolVariants.set(name, []);
      const variants = toolVariants.get(name);
      const existing = variants.find((v) => sameJson(v.schema, tool));
      if (existing) {
        existing.runKinds.add(runKind);
      } else {
        variants.push({ runKinds: new Set([runKind]), schema: tool });
      }
    }
  }
}

// macOS/Windows filesystems are case-insensitive, so distinct tool names that
// only differ by case (e.g. grok-4.5's "grep" vs Composer's "Grep") would
// silently clobber each other on disk. Disambiguate any such collision by
// suffixing the later name with its owning run kind(s).
const usedLowerNames = new Map(); // lowercase filename stem -> original tool name
const toolArtifacts = [];

for (const [name, variants] of toolVariants) {
  let safeName = name.replace(/[^A-Za-z0-9_.-]+/g, "_");
  const lower = safeName.toLowerCase();
  if (usedLowerNames.has(lower) && usedLowerNames.get(lower) !== safeName) {
    const disambiguator = [...variants[0].runKinds][0] || "variant";
    safeName = `${safeName}-${disambiguator}`;
  }
  usedLowerNames.set(lower, safeName);
  const filePath = path.join(outDir, "tools", `${safeName}.json`);
  toolArtifacts.push(`tools/${safeName}.json`);
  if (variants.length === 1) {
    fs.writeFileSync(
      filePath,
      `${JSON.stringify(
        { name, schema: variants[0].schema },
        null,
        2,
      )}\n`,
    );
  } else {
    fs.writeFileSync(
      filePath,
      `${JSON.stringify(
        {
          name,
          variants: variants.map((v) => ({
            run_kinds: [...v.runKinds].sort(),
            schema: v.schema,
          })),
        },
        null,
        2,
      )}\n`,
    );
  }
}

const observedRelease = process.env.CAPTURE_TARGET_VERSION;
if (!observedRelease) throw new Error("CAPTURE_TARGET_VERSION is required for Grok extraction");
const runModels = [...new Set(
  [...byRunKind.values()].flat().map(({ body }) => body.model).filter(Boolean),
)].sort();
const runModes = [...new Set(
  [...byRunKind.keys()].map((runKind) => runKind === "grok-session-title"
    ? "session-title"
    : runKind.endsWith("-interactive") ? "interactive" : "non-interactive"),
)].sort();
writeSurfaceObservations(
  path.resolve(
    process.env.CAPTURE_SURFACE_INVENTORY || path.join(outDir, "..", "surface-observations.json"),
  ),
  "grok",
  observedRelease,
  [
    ...promptSurfaces,
    ...(steeringEntries.length > 0 ? [{
      id: "grok.steering.catalog",
      category: "steering messages",
      models: steeringEntries.map((entry) => entry.model),
      modes: steeringEntries.map((entry) => entry.mode),
      artifacts: steeringEntries.map((entry) => entry.artifact),
    }] : []),
    {
      id: "grok.tool.catalog",
      category: "tool schemas",
      models: runModels,
      modes: runModes,
      artifacts: toolArtifacts,
    },
  ],
);

console.log(`Wrote ${byRunKind.size} prompt file(s) and ${toolVariants.size} tool file(s) to ${outDir}`);
