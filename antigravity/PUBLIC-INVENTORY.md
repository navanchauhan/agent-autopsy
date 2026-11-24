# Public-source inventory: Antigravity CLI

Checked 2026-11-24 UTC. This is a public documentation and release-metadata
check, not a request trace or a live observation of model-facing content. The
existing `VERSION` and `SURFACES.json` describe the earlier archive.

- **Release observed:** the [official Linux x64 manifest](https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_amd64.json) reported version `1.5.16`, [tarball](https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.16-5250855658717184/linux-x64/cli_linux_x64.tar.gz), and SHA-512 `3dee9f26e298156db673f6ce2a0f5dfed5b30006e04ceb9809c68070e7b717587b33a3da0f8bc2eda45af81a50bc8b14c82b28ae5832bcfe3e7fd49397117b31`. The downloaded manifest bytes had SHA-256 `2cc4265ad27bda7d726ba3b4c580775e7fa72926023a37fbfcf3c89bdddac817`; the tarball itself was not downloaded or verified.
- **Documented capabilities:** Google's [CLI codelab](https://codelabs.developers.google.com/antigravity-cli-hands-on) describes multi-file editing, tool calling and permission modes. The retrieved HTML had SHA-256 `3aa0d47e4f09de9960b2b8930590fc2a17035a1be2801b36509f77d88cf191f6`.
- **Not accessible from these sources:** the exact current model-facing prompt and tool declarations. No claim is made that older archived artifacts match 1.5.16. Documentation is not version-pinned to this binary and is not a schema inventory.

## SDK, permissions and customization

The [public SDK tools reference](https://antigravity.google/docs/sdk/tools/) documents `list_directory`, `search_directory`, `find_file`, `view_file`, `create_file`, `edit_file`, `run_command`, `ask_question`, `start_subagent`, `generate_image`, `search_web`, `read_url_content`, and `finish`. These are SDK identifiers, not a claim about CLI wire schemas or active tools. `CapabilitiesConfig` supports `enabled_tools` and `disabled_tools`; custom Python functions and MCP add tools. Retrieved page HTML SHA-256: `3ad8f93d431af070ade5c0f88f6d8387061c8f54b9e20092bd892ff285fabe30`.

The [CLI permissions reference](https://antigravity.google/docs/cli-permissions) documents `read_file`, `write_file`, `read_url`, `execute_url`, `command`, `unsandboxed`, and `mcp` as permission actions, not tool declarations. Deny takes precedence over ask and allow; modes and sandbox availability change fallback behavior. [Rules](https://antigravity.google/docs/rules/) and [customization discovery](https://antigravity.google/docs/customization-discovery?tab=cli) describe user-authored AGENTS.md/GEMINI.md, skills, plugins, hooks and MCP. Actual local configuration was not inspected.

Local `agy --version` returned `1.5.14`, distinct from the manifest's Linux 1.5.16; no login or model request was made. The public SDK and mutable documentation are not pinned to either CLI binary, and do not establish changes in the older archived CLI request schema.

## Public model names

As checked 2026-11-24 UTC, Google's [model documentation](https://antigravity.google/docs/models) names Gemini 4 Neon, Carbon, Argon and Hydrogen; it documents a CLI alias example `gemini-4-neon-xhigh` and Orchestrator (Neon) as a selector pairing Neon planning with Hydrogen implementation. These are documented names and a selector configuration, not observed model IDs or evidence of a new captured prompt. The CLI-oriented table lists Neon for paid/eligible trial Pro, Ultra and Enterprise, and Hydrogen for non-trial paid Pro, Ultra and Enterprise; App-oriented documentation shows different availability. Consult the current surface-specific table. The page does not establish release dates for these models. Retrieved HTML SHA-256 `b2dff0fbc12ffd54d57c4ec9f1e282cb2aa8666806f085e23828496cb5dd4a25`.

Google's [Neon announcement](https://antigravity.google/blog/gemini-4-neon-in-google-antigravity) is dated 2026-11-18. It describes the Neon/Hydrogen pairing; this check did not establish Hydrogen's launch date.

## Supported CLI observation

On 2026-11-24 UTC, local `agy --version` reported `1.5.14` and the supported `agy models` command returned successfully. It listed Neon aliases `gemini-4-neon-{low,medium,high,xhigh}` and Hydrogen aliases `gemini-4-hydrogen-{low,medium,high,xhigh}`, as well as Carbon, Argon, three Orchestrator selectors, Gemini 3.8 Flash, Claude Opus 5.5, Claude Sonnet 5.5 and GPT-OSS 120B. **Verified:** these identifiers appeared in that command's listing for this CLI invocation. **Unavailable:** that command does not expose the actual selected model, a completed model request, its assembled prompt, or tool schemas. Listing an alias does not prove that a model request succeeds or that the same aliases apply to Linux release 1.5.16. No request was made.
