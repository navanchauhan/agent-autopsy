# Claude Code

Claude Code is Anthropic's coding agent. These artifacts were extracted from the installed native Claude Code binary by tracing the real `/v1/messages` payload, following the approach described in the referenced write-up.

- `prompts/` contains raw captured prompt text grouped by model. Run-specific scalar values are marked with `<harnessVariable>{{name=example}}</harnessVariable>`; repeated runtime sections use `{{#each collectionName}}...{{/each}}` blocks inside `<harnessVariable>...</harnessVariable>`. Haiku's session-title prompt is stored separately because it is a distinct observed prompt.
- `tools/` contains one JSON file per observed tool. When a tool payload differs by model or capture mode, the file contains `variants[]`; each nested `schema` is the exact tool object sent to the listed model(s)/capture mode(s).
- `misc/` contains support scripts and non-system steering captured from the tmux interactive Claude Code REPL, including `<system-reminder>` blocks for deferred tools, available skills, and user-context metadata.
- `VERSION` records the Claude Code versions, platform, binary checksum, capture commands, and model/tool counts.

Run a fresh non-interactive capture with the root extraction flow, then run a fresh interactive capture with:

```sh
trace_dir=$(mktemp -d /tmp/claude-trace.XXXXXX)
CLAUDE_TRACE_DIR="$trace_dir" BUN_OPTIONS=--preload=./claude-code/misc/scripts/trace-claude-messages.cjs claude --dangerously-skip-permissions --strict-mcp-config --tools default
node claude-code/misc/scripts/extract-claude-trace.cjs "$trace_dir"
```

Notes:
- **2.1.207 refresh:** All six non-interactive model captures succeeded. The shared prompt dropped its final "When you have enough information to act" paragraph, fable broadened its harness wording from `<system-reminder>` tags to mid-conversation system turns, and the eager tool payload gained `DeferredToolPlaceholder` and `Workflow`; `Agent`, `Bash`, and `ScheduleWakeup` also changed schemas or descriptions. The tmux interactive command was run twice, but 2.1.207 refused `--dangerously-skip-permissions` under this root-run CI container before sending a request, so interactive artifacts remain at their prior successful capture state; no interactive schema or prompt was inferred from the non-interactive run.
- `extract-claude-trace.cjs` only handles the **interactive** trace dir: it always writes `prompts/<model>-interactive.md` and tags merged tool variants `capture_modes: ["interactive"]`, and it deletes any existing `*-interactive.md`/`*-interactive-steering.md` files at the start of every run (so re-running it is safe/idempotent for interactive output, but it must not be pointed at a non-interactive trace dir — it will mislabel the output). There is currently no checked-in script for the **non-interactive** (`-p`) capture; that side of the refresh (writing `prompts/<model>.md` with no suffix and merging `tools/*.json` with `capture_modes: ["non-interactive"]`) has so far been done by hand each round, re-deriving the same harness-variable redaction and schema-based variant de-duplication logic from `extract-claude-trace.cjs`. A `--mode non-interactive` flag (or a sibling script) would remove this manual step; see `VERSION`'s `capture_fixes` field for the 2.1.206 round's notes on this gap.
- For each of the 6 `prompt_models`, run: `BUN_OPTIONS=--preload=./claude-code/misc/scripts/trace-claude-messages.cjs claude -p "Reply exactly: TRACE_FETCH_<model>" --model <model> --output-format json --no-session-persistence --exclude-dynamic-system-prompt-sections --strict-mcp-config --tools default` (the default trace dir is `artifacts/trace/messages` under the repo root when `CLAUDE_TRACE_DIR` is unset — this is the "root extraction flow").
