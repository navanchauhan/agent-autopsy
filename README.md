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

## Automated refresh

`.github/workflows/daily-refresh.yml` runs daily and checks whether Claude Code, Codex, Antigravity, or Grok shipped a new version since the last capture. When one has, it re-runs that tool's documented `README.md` "Refresh commands" (both non-interactive and interactive-tmux capture), hands the diffing/rewrite work to `codex exec` acting as an orchestrator that spawns one subagent per changed tool, and — only if something actually changed — commits, tags `YYYY.MM.DD`, and cuts a GitHub release. A no-op day produces no commit, no tag, no release. `Dockerfile` at the repo root builds the container this runs in; `.github/scripts/` holds the individual pipeline steps. ampcode is intentionally excluded (see its own README for why).
