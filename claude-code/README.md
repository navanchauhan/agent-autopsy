# Claude Code

Claude Code is Anthropic's coding agent. These artifacts were extracted from the installed native Claude Code binary by tracing the real `/v1/messages` payload, following the approach described in the referenced write-up.

- `prompts/` contains raw captured prompt text grouped by model. Run-specific values are marked with `<harnessVariable>example</harnessVariable>`. Haiku's session-title prompt is stored separately because it is a distinct observed prompt.
- `tools/` contains one JSON file per observed tool. When a tool payload differs by model or capture mode, the file contains `variants[]`; each nested `schema` is the exact tool object sent to the listed model(s)/capture mode(s).
- `misc/` contains support scripts and non-system steering captured from the tmux interactive Claude Code REPL, including `<system-reminder>` blocks for deferred tools, available skills, and user-context metadata.
- `VERSION` records the Claude Code versions, platform, binary checksum, capture commands, and model/tool counts.

Run a fresh non-interactive capture with the root extraction flow, then run a fresh interactive capture with:

```sh
trace_dir=$(mktemp -d /tmp/claude-trace.XXXXXX)
CLAUDE_TRACE_DIR="$trace_dir" BUN_OPTIONS=--preload=claude-code/misc/scripts/trace-claude-messages.cjs claude --dangerously-skip-permissions --strict-mcp-config --tools default
node claude-code/misc/scripts/extract-claude-trace.cjs "$trace_dir"
```
