# Claude Code

Claude Code is Anthropic's coding agent. These artifacts were extracted from the installed native Claude Code binary by tracing the real `/v1/messages` payload, following the approach described in the referenced write-up.

- `prompts/` contains raw captured prompt text grouped by model. Run-specific values are marked with `<harnessVariable>example</harnessVariable>`. Haiku's session-title prompt is stored separately because it is a distinct observed prompt.
- `tools/` contains one JSON file per observed tool. When a tool payload differs by model, the file contains `variants[]`; each nested `schema` is the exact tool object sent to the listed model(s).
- `VERSION` records the Claude Code version, platform, binary checksum, capture command, and model/tool counts.
