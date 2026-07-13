#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DEFAULT_OUT_DIR = process.env.CAPTURE_SCRATCH_DIR
  ? path.resolve(process.env.CAPTURE_SCRATCH_DIR, "ampcode", "candidate")
  : path.resolve(process.cwd(), "ampcode");

function usage() {
  console.error("Usage: node ampcode/misc/scripts/extract-amp-inspect.cjs <inspect-json-dir> [out-dir]");
  process.exit(2);
}

function safeFileName(name) {
  return name.replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function harnessScalar(name, example) {
  return `<harnessVariable>{{${name}=${example}}}</harnessVariable>`;
}

const AVAILABLE_SKILLS_MARKDOWN_HARNESS = `<harnessVariable>
{{#each availableSkills}}
- {{name}}: {{description}} (file: {{location}})
{{/each}}

Example:
- example-skill: Example user-installed skill description. (file: file:///Users/example/.agents/skills/example-skill/SKILL.md)
</harnessVariable>`;

const AVAILABLE_SKILLS_XML_HARNESS = `<harnessVariable>
{{#each availableSkills}}
  <skill>
    <name>{{name}}</name>
    <description>{{description}}</description>
    <location>{{location}}</location>
  </skill>
{{/each}}

Example:
  <skill>
    <name>example-skill</name>
    <description>Example user-installed skill description.</description>
    <location>file:///Users/example/.agents/skills/example-skill/SKILL.md</location>
  </skill>
</harnessVariable>`;

const DIRECTORY_LISTING_HARNESS = `<harnessVariable>
{{#each workspaceTopLevelEntries}}
{{absolutePath}}
{{/each}}

Example:
/Users/example/Developer/example-repo/src/
/Users/example/Developer/example-repo/package.json
</harnessVariable>`;

const LINE_VARIABLE_NAMES = {
  "Today's date": "currentDate",
  "Working directory": "currentWorkingDirectory",
  "Workspace root": "workspaceRoot",
  "Operating system": "operatingSystem",
  Repository: "repositoryUrl",
  "Amp Thread URL": "ampThreadUrl",
};

function sanitizeExample(value) {
  return value
    .replace(/https:\/\/github\.com\/[^/\s]+\/[^/\s<>"')\]]+/g, "https://github.com/example-org/example-repo")
    .replace(/https:\/\/ampcode\.com\/threads\/T-[0-9a-f-]+/gi, "https://ampcode.com/threads/T-00000000-0000-4000-8000-000000000000")
    .replace(/\/Users\/[^/]+\/Developer\/[^/\s<>"')\]]+/g, "/Users/example/Developer/example-repo")
    .replace(/\/Users\/[^/]+\/\.agents\/skills/g, "/Users/example/.agents/skills")
    .replace(/\/Users\/[^/]+\//g, "/Users/example/");
}

function harnessScalarForValue(value, fallbackName = "runtimeValue") {
  const example = sanitizeExample(value);
  let name = fallbackName;
  if (/^https:\/\/github\.com\//.test(example)) name = "repositoryUrl";
  else if (/^https:\/\/ampcode\.com\/threads\//.test(example)) name = "ampThreadUrl";
  else if (/^(?:file:\/\/)?\/Users\/example\/\.agents\/skills/.test(example)) name = "skillLocation";
  else if (/^\/Users\/example\//.test(example)) name = "absolutePath";
  return harnessScalar(name, example);
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
    let example = sanitizeExample(value);
    if (label === "Today's date") example = "Mon Jan 2 2026";
    return `${prefix}${harnessScalar(LINE_VARIABLE_NAMES[label], example)}`;
  });
}

function markHarnessVariables(text) {
  let out = text.replace(
    /(<available_skills>\n)([\s\S]*?)(\n<\/available_skills>)/g,
    (_, prefix, _skills, suffix) => `${prefix}${AVAILABLE_SKILLS_XML_HARNESS}${suffix}`,
  );
  out = out.replace(
    /(### Available skills\n)([\s\S]*?)(\n### How to use skills)/g,
    (_, prefix, _skills, suffix) => `${prefix}${AVAILABLE_SKILLS_MARKDOWN_HARNESS}${suffix}`,
  );
  out = out.replace(
    /(## Directory listing\nList of files \(top-level only\) in the user's workspace:\n)([\s\S]*?)(\n\n## Skills)/g,
    (_, prefix, _listing, suffix) => `${prefix}${DIRECTORY_LISTING_HARNESS}${suffix}`,
  );
  out = replaceOutsideHarness(out, /\/Users\/[^/]+\/[^\s<>"')\]]+/g, (value) =>
    harnessScalarForValue(value, "absolutePath"),
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

function main() {
  const inspectDir = process.argv[2] ? path.resolve(process.argv[2]) : "";
  if (!inspectDir) usage();

  const outDir = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUT_DIR;
  const records = readInspectRecords(inspectDir);
  if (records.length === 0) {
    throw new Error(`No Amp inspect JSON records found in ${inspectDir}`);
  }

  const promptsDir = path.join(outDir, "prompts");
  fs.mkdirSync(promptsDir, { recursive: true });
  removeGeneratedFiles(promptsDir, ".md");

  for (const record of records) {
    fs.writeFileSync(
      path.join(promptsDir, `${safeFileName(record.agentMode)}.md`),
      `${markHarnessVariables(record.systemPrompt).trimEnd()}\n`,
    );
  }

  updateVersion(outDir, records);
}

main();
