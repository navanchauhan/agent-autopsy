# Claude Code Interactive

These artifacts were captured from a real tmux Claude Code REPL session by preloading `claude-code/scripts/trace-claude-messages.cjs` and sending `Reply exactly: CLAUDE_INTERACTIVE_TRACE_OK`.

- `prompts/` contains the interactive system prompt grouped by model. Run-specific values are marked with `<harnessVariable>example</harnessVariable>`.
- `tools/` contains one JSON file per exact `/v1/messages` `tools[]` object sent in the interactive main request.
- `VERSION` records the captured user-agent version, installed version at extraction time, binary checksum, capture command, and tool counts.
