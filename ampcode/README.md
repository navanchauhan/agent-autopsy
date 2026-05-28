# Amp Code

Amp is Sourcegraph's coding agent. These artifacts were extracted from the installed `amp` binary and live CLI behavior.

- `prompts/` contains exact `tools list --inspect --json` system prompts grouped by Amp agent mode. Run-specific scalar values are marked with `<harnessVariable>{{name=example}}</harnessVariable>`; repeated runtime sections use `{{#each collectionName}}...{{/each}}` blocks inside `<harnessVariable>...</harnessVariable>`.
- `tools/` contains one JSON file per observed Amp tool. The nested `schema` is the exact `amp tools show --json` tool definition for the listed mode(s).
- `misc/` contains support scripts and capture side artifacts.
- `VERSION` records the Amp version, binary checksums, capture commands, prompt modes, and tool counts.

Notes:
- Amp's normal interactive tmux path uses a server actor and does not expose the final model request locally. The checked-in prompt files come from Amp's own local inspect implementation, using a throwaway patched copy of the installed binary to bypass the inspect permission gate. The patched binary is not stored.
- The interactive tmux capture verified smart mode returned `AMP_INTERACTIVE_TRACE_OK`, advertised 37 executor tools to the actor, and reported 16 inference tools for smart mode.
