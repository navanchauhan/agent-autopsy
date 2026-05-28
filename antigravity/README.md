# Antigravity CLI

Antigravity CLI is Google's coding agent. These artifacts were extracted from the installed `agy` binary by enabling verbose `CODEIUM_VMODULE='*=5'` logging and parsing the real `Cortex API Request` payload sent to `streamGenerateContent`.

- `prompts/` contains raw captured prompt text grouped by model. Run-specific values are marked with `<harnessVariable>example</harnessVariable>`.
- `tools/` contains one JSON file per observed Gemini function declaration. The nested `schema` is the exact `request.tools[]` wrapper sent for that function.
- `VERSION` records the Antigravity CLI version, install manifest, binary checksums, capture command, and model/tool counts.

Run a fresh capture with:

```sh
trace_dir=$(mktemp -d /tmp/agy-trace.XXXXXX)
CODEIUM_VMODULE='*=5' agy --add-dir "$PWD" --print 'Reply exactly: ANTIGRAVITY_TRACE_OK' --print-timeout 90s --log-file "$trace_dir/agy.log"
node antigravity/scripts/extract-antigravity-log.cjs "$trace_dir/agy.log"
```
