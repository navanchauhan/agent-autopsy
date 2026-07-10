# Agent Autopsy

Collection of prompts and tool schemas for coding agents.

Each coding-agent directory follows the same shape:

- `prompts/`: captured prompt files, with run-specific scalar values marked as `<harnessVariable>{{name=example}}</harnessVariable>` and repeated runtime sections marked with `{{#each collectionName}}...{{/each}}` inside `<harnessVariable>...</harnessVariable>`.
- `tools/`: one JSON file per observed tool. Each `schema` entry is the exact tool payload sent to the model; files use `variants[]` when payloads differ by model or capture mode.
- `misc/`: steering messages, feature-specific runtime messages, and extraction scripts.
- `README.md`: capture notes and refresh commands.
- `VERSION`: source version, capture metadata, and counts.

Agents:

- `codex/`: prompts, tool schemas, and goal-feature steering from the Codex source tree.
- `claude-code/`: Claude Code non-interactive and tmux interactive captures in the shared layout.
- `antigravity/`: Antigravity CLI non-interactive and tmux interactive captures in the shared layout.
- `ampcode/`: Amp prompts and mode-specific tool schemas. **Unsupported/frozen** — both known capture paths (local `--inspect` gate bypass and network mitm) are exhausted as of version 0.0.1783542413-gb55c7a; see `ampcode/README.md`.
- `grok/`: xAI Grok CLI non-interactive and tmux interactive captures, taken via a local mitmproxy network capture of the real `/v1/responses` request payload.
