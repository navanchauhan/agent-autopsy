# Codex

Codex CLI is OpenAI's coding agent. Codex is open-source, so no reverse-engineering is needed!

- `prompts/` contains prompt templates extracted from the Codex source tree. Run-specific scalar values are marked with `<harnessVariable>{{name=example}}</harnessVariable>`; repeated runtime sections use `{{#each collectionName}}...{{/each}}` blocks inside `<harnessVariable>...</harnessVariable>`.
- `tools/` contains one JSON file per Responses API tool schema observed in the source extraction.
- `misc/` contains runtime steering that is not a top-level system prompt, including the goal feature's hidden `<goal_context>` messages and completion reminder.
- `VERSION` records the Codex source revision (`reference_path = references/codex`) and extraction counts.

Unlike the other agents in this repo, there is no network capture step here at all — mitmproxy/binary tracing is never used for Codex, since the source tree already contains the exact prompt/tool text.

Refresh commands (no live capture — pull the source and re-read it):

```sh
git clone https://github.com/openai/codex.git references/codex   # or, if it already exists:
git -C references/codex pull
```

Then re-extract `prompts/`, `tools/`, and `misc/` by reading the updated `references/codex` tree directly (grep for each currently-checked-in file's distinctive strings to relocate it, since paths can move between revisions — see `codex/VERSION`'s notes field for the pattern), diff against what's committed here, and update only what actually changed. `references/codex` itself is gitignored (a full foreign git history, not part of this repo) and is re-synced fresh by `.github/scripts/sync-codex-reference.sh` on every automated run — see the root `README.md`'s "Automated refresh" section.

Current capture revision: `c888e8e75a9f0e90ce7d5517f8b9540832cbbf76` (2026-07-12). Re-extraction from this revision produced no real prompt, tool-schema, or runtime-steering changes; the model catalog's removal of `supports_reasoning_summaries` is capability metadata, while the approval refactor and safety-buffering wording changes are internal/UI behavior outside the captured model-visible surface. See `VERSION` for the source-level verification notes.
