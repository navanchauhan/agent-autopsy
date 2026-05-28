#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DEFAULT_OUT_DIR = path.resolve(process.cwd(), "ampcode");

function usage() {
  console.error("Usage: node ampcode/misc/scripts/extract-amp-inspect.cjs <inspect-json-dir> [out-dir]");
  process.exit(2);
}

function safeFileName(name) {
  return name.replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function harnessVariable(value) {
  return `<harnessVariable>${value}</harnessVariable>`;
}

function harnessBlock(value) {
  return `<harnessVariable>\n${value}\n</harnessVariable>`;
}

function replaceOutsideHarness(text, regexp, replacer) {
  return text
    .split(/(<harnessVariable>[\s\S]*?<\/harnessVariable>)/g)
    .map((part) => (part.startsWith("<harnessVariable>") ? part : part.replace(regexp, replacer)))
    .join("");
}

function removeGeneratedFiles(dir, extension) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(extension)) {
      fs.rmSync(path.join(dir, entry.name));
    }
  }
}

function markLineValue(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`^(${escaped}: )([^\\n]+)$`, "gm"), (_, prefix, value) => {
    if (value.includes("<harnessVariable>")) return `${prefix}${value}`;
    return `${prefix}${harnessVariable(value)}`;
  });
}

function markHarnessVariables(text) {
  let out = text.replace(
    /(<available_skills>\n)([\s\S]*?)(\n<\/available_skills>)/g,
    (_, prefix, skills, suffix) => `${prefix}${harnessBlock(skills.trimEnd())}${suffix}`,
  );
  out = out.replace(
    /(### Available skills\n)([\s\S]*?)(\n### How to use skills)/g,
    (_, prefix, skills, suffix) => `${prefix}${harnessBlock(skills.trimEnd())}${suffix}`,
  );
  out = replaceOutsideHarness(out, /\/Users\/navanchauhan\/[^\s<>"')\]]+/g, (value) =>
    harnessVariable(value),
  );

  for (const label of [
    "Today's date",
    "Working directory",
    "Workspace root",
    "Operating system",
    "Repository",
    "Amp Thread URL",
  ]) {
    out = markLineValue(out, label);
  }

  return out;
}

function readInspectRecords(inspectDir) {
  const records = [];
  for (const entry of fs.readdirSync(inspectDir).sort()) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(inspectDir, entry);
    const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!record.agentMode || !record.systemPrompt) continue;
    records.push({
      file: entry,
      agentMode: record.agentMode,
      systemPrompt: record.systemPrompt,
      toolCount: record.tools?.length || 0,
    });
  }
  return records;
}

function updateVersion(outDir, records) {
  const versionPath = path.join(outDir, "VERSION");
  const modeNames = records.map((record) => record.agentMode).sort();
  const promptLines = [
    "inspect_script = ampcode/misc/scripts/extract-amp-inspect.cjs",
    "inspect_capture = patched local copy of the installed Amp binary with only the `tools list --inspect` permission gate disabled; no patched binary is stored",
    `prompt_modes = ${modeNames.join(", ")}`,
    `prompts = ${records.length}`,
    ...records
      .sort((a, b) => a.agentMode.localeCompare(b.agentMode))
      .map((record) => `mode_${record.agentMode}_inspect_tools = ${record.toolCount}`),
  ];

  const previous = fs.existsSync(versionPath)
    ? fs.readFileSync(versionPath, "utf8").trimEnd().split("\n")
    : [];
  const filtered = previous.filter(
    (line) =>
      !line.startsWith("inspect_script = ") &&
      !line.startsWith("inspect_capture = ") &&
      !line.startsWith("prompt_models = ") &&
      !line.startsWith("prompt_modes = ") &&
      !line.startsWith("prompts = ") &&
      !/^mode_.*_inspect_tools = /.test(line),
  );
  fs.writeFileSync(versionPath, `${[...filtered, ...promptLines].join("\n")}\n`);
}

function writeReadme(outDir) {
  fs.writeFileSync(
    path.join(outDir, "README.md"),
    `# Amp Code\n\nAmp is Sourcegraph's coding agent. These artifacts were extracted from the installed \`amp\` binary and live CLI behavior.\n\n- \`prompts/\` contains exact \`tools list --inspect --json\` system prompts grouped by Amp agent mode. Run-specific values are marked with \`<harnessVariable>example</harnessVariable>\`.\n- \`tools/\` contains one JSON file per observed Amp tool. The nested \`schema\` is the exact \`amp tools show --json\` tool definition for the listed mode(s).\n- \`misc/\` contains support scripts and capture side artifacts.\n- \`VERSION\` records the Amp version, binary checksums, capture commands, prompt modes, and tool counts.\n\nNotes:\n- Amp's normal interactive tmux path uses a server actor and does not expose the final model request locally. The checked-in prompt files come from Amp's own local inspect implementation, using a throwaway patched copy of the installed binary to bypass the inspect permission gate. The patched binary is not stored.\n- The interactive tmux capture verified smart mode returned \`AMP_INTERACTIVE_TRACE_OK\`, advertised 37 executor tools to the actor, and reported 16 inference tools for smart mode.\n`,
  );
}

function main() {
  const inspectDir = process.argv[2] ? path.resolve(process.argv[2]) : "";
  if (!inspectDir) usage();

  const outDir = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUT_DIR;
  const promptsDir = path.join(outDir, "prompts");
  fs.mkdirSync(promptsDir, { recursive: true });
  removeGeneratedFiles(promptsDir, ".md");

  const records = readInspectRecords(inspectDir);
  if (records.length === 0) {
    throw new Error(`No Amp inspect JSON records found in ${inspectDir}`);
  }

  for (const record of records) {
    fs.writeFileSync(
      path.join(promptsDir, `${safeFileName(record.agentMode)}.md`),
      `${markHarnessVariables(record.systemPrompt).trimEnd()}\n`,
    );
  }

  writeReadme(outDir);
  updateVersion(outDir, records);
}

main();
