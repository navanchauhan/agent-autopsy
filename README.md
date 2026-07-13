# Agent Autopsy

Archive of model-facing prompts and tool schemas from coding-agent CLIs.

## Archive format

- `prompts/` contains captured system prompts or source-derived prompt templates.
- `tools/` contains one JSON file per observed tool. `schema` values are exact model-facing payloads; `variants[]` preserves payload differences by model or capture mode.
- `misc/` contains captured steering messages and the scripts used to collect or extract artifacts.
- `VERSION` records the current captured source version, provenance, active limitations, and artifact counts.

Run-specific values are replaced with `<harnessVariable>{{name=example}}</harnessVariable>`. Repeated runtime sections use `{{#each collectionName}}...{{/each}}` inside a harness-variable block.

## Agents

| Agent | Source method | Status |
| --- | --- | --- |
| [Codex](codex/README.md) | Direct extraction from the open-source Codex tree | Active |
| [Claude Code](claude-code/README.md) | Traced Anthropic `/v1/messages` requests | Active; some capture modes lag the current binary |
| [Antigravity CLI](antigravity/README.md) | Parsed verbose `Cortex API Request` logs | Active |
| [Grok CLI](grok/README.md) | Redacted mitmproxy capture of `/v1/responses` | Active |
| [Amp Code](ampcode/README.md) | Local tool inspection and prior prompt inspection | Frozen; prompt capture is unavailable |

## Capture integrity

- Preserve model-facing prompt and schema text exactly. Normalize only host-, user-, session-, or request-specific values.
- Keep distinct payloads as variants rather than merging meaningful differences.
- Treat timestamps, trace filenames and line numbers, temporary paths, locally installed skills, and machine-specific MCP state as provenance noise unless they alter the product-owned payload.
- Never commit raw traces or credentials. Capture scripts must redact authentication material before an artifact is retained.
- READMEs describe the current method and active limitations. Git history and releases record past changes.

## Automated refresh

`.github/workflows/daily-refresh.yml` installs the current Claude Code, Antigravity, and Grok CLIs to compare their versions, and checks Codex by upstream source revision. When a supported source changes, the refresh job runs the relevant documented capture flow in a container, compares semantic output, independently reviews the candidate against capture/source evidence, and publishes a commit and dated release only when the repository changes. Amp is excluded while its prompt capture remains unavailable.

The canonical agent report stays Markdown, with one section per changed tool, and becomes the GitHub release notes. Reviewer JSON is an internal publication gate rather than the human-facing archive view.
