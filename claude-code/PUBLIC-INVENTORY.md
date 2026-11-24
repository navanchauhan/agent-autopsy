# Public-source inventory: Claude Code

Checked 2026-11-24 UTC. This is a public documentation and release-metadata
check, not a request trace or a live observation of model-facing content. The
existing `VERSION` and `SURFACES.json` describe the earlier archive.

- **Release observed:** GitHub's latest-release API reported [v2.1.331](https://github.com/anthropics/claude-code/releases/tag/v2.1.331), published 2026-11-23; npm reported `@anthropic-ai/claude-code` version `2.1.331`. Neither establishes the version of a live session.
- **Documented prompt and tool controls:** the [settings documentation](https://code.claude.com/docs/en/settings) describes user-configurable behavior and tool permissions. The retrieved HTML had SHA-256 `88a0da0f410c3be2c73964215de667b5ea6cf7da317af48542b269c7fdea4dd4`. This mutable documentation is not pinned to the release above.
- **Not accessible from these sources:** the exact current model-facing prompt and tool schemas. No claim is made that older archived artifacts match 2.1.331. A public documentation check does not validate request contents.

## Documented tools and customization

[PUBLIC-TOOLS.md](PUBLIC-TOOLS.md) enumerates the official tools-reference table and its manual-mode permission column, including conditional and removed entries. Actual availability varies by platform, session, model, account and settings. For example, the reference says Glob and Grep are absent by default on macOS/Linux/WSL in specified circumstances; PowerShell and LSP have separate enablement conditions. Permission rules, hooks and sandboxing are distinct controls; see [permissions](https://code.claude.com/docs/en/permissions).

The [Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript#tool-input-schemas) publishes input types including `BashInput` (`command`, optional timeout, description, background and sandbox flag), `AgentInput`, file, task, MCP and web inputs. These are SDK interfaces, not evidence of the wire schema or enabled CLI tools. npm reported SDK `0.3.331`, integrity `sha512-ml/MPqgO95tG5zcApBFxEyoDk57d9htP09R8AtPbKPUCHpsobf84IjkN4zhGvQgk8zsA9dXoeMGrQcCc8gQE/w==`; the retrieved mutable SDK documentation had SHA-256 `9e1deb24d31cb16a695be08c7fbc7948f6e1fada4085b6c1e6b234c06f063cc5`.

User-authored [CLAUDE.md and rules](https://code.claude.com/docs/en/memory), SDK [system-prompt customization](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts), skills and MCP are documented extension surfaces. Their actual local contents were not inspected. Local `claude --version` returned `2.1.331`; no login or model request was made. No exact prompt or schema change from the archived 2.1.270 capture is established by these public docs.
