# Codex

Codex CLI is OpenAI's coding agent. Codex is open-source, so no reverse-engineering is needed!

- `prompts/` contains prompt templates extracted from the Codex source tree. Run-specific scalar values are marked with `<harnessVariable>{{name=example}}</harnessVariable>`; repeated runtime sections use `{{#each collectionName}}...{{/each}}` blocks inside `<harnessVariable>...</harnessVariable>`.
- `tools/` contains one JSON file per Responses API tool schema observed in the source extraction.
- `misc/` contains runtime steering that is not a top-level system prompt, including the goal feature's hidden `<goal_context>` messages and completion reminder.
- `VERSION` records the Codex source revision and extraction counts.
