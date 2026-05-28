# Antigravity CLI

Antigravity CLI is Google's coding agent. These artifacts were extracted from the installed `agy` binary by enabling verbose `CODEIUM_VMODULE='*=5'` logging and parsing the real `Cortex API Request` payload sent to `streamGenerateContent`.

- `prompts/` contains raw captured prompt text grouped by model. Run-specific scalar values are marked with `<harnessVariable>{{name=example}}</harnessVariable>`; repeated runtime sections use `{{#each collectionName}}...{{/each}}` blocks inside `<harnessVariable>...</harnessVariable>`.
- `tools/` contains one JSON file per observed Gemini function declaration. The nested `schema` is the exact `request.tools[]` wrapper sent for that function. Files use `variants[]` when payloads differ by capture mode.
- `misc/` contains support scripts and capture side artifacts.
- `VERSION` records the Antigravity CLI version, install manifest, binary checksums, capture command, and model/tool counts.

Run a fresh non-interactive capture with:

```sh
trace_dir=$(mktemp -d /tmp/agy-trace.XXXXXX)
CODEIUM_VMODULE='*=5' agy --add-dir "$PWD" --print 'Reply exactly: ANTIGRAVITY_TRACE_OK' --print-timeout 90s --log-file "$trace_dir/agy.log"
node antigravity/misc/scripts/extract-antigravity-log.cjs "$trace_dir/agy.log"
```

Run a fresh interactive capture with:

```sh
trace_dir=$(mktemp -d /tmp/agy-interactive.XXXXXX)
tmux new-session -d -s agy-trace "cd $PWD && CODEIUM_VMODULE='*=5' agy --add-dir \"$PWD\" --dangerously-skip-permissions --log-file \"$trace_dir/agy.log\""
tmux send-keys -t agy-trace 'Reply exactly: ANTIGRAVITY_INTERACTIVE_TRACE_OK' Enter
AGY_CAPTURE_MODE=interactive node antigravity/misc/scripts/extract-antigravity-log.cjs "$trace_dir/agy.log"
```
