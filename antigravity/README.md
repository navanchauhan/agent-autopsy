# Antigravity CLI

## Capture method

Antigravity is captured from the installed `agy` binary. With `CODEIUM_VMODULE='*=5'`, the CLI logs the real `Cortex API Request` payload sent to `streamGenerateContent`; `extract-antigravity-log.cjs` extracts its system prompt and Gemini function declarations.

Both non-interactive and interactive modes are retained because their prompt framing may differ.

## Refresh

Run both modes into the same scratch output directory:

```sh
repo_root=$PWD
scratch_root=${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}
mkdir -p "$scratch_root/antigravity/raw"
work_dir=$(mktemp -d "$scratch_root/antigravity/raw/run.XXXXXX")
out_dir="$scratch_root/antigravity/candidate"

CODEIUM_VMODULE='*=5' agy --add-dir "$repo_root" \
  --print 'Reply exactly: ANTIGRAVITY_TRACE_OK' \
  --print-timeout 90s --log-file "$work_dir/non-interactive.log"
node antigravity/misc/scripts/extract-antigravity-log.cjs \
  "$work_dir/non-interactive.log" "$out_dir"

tmux new-session -d -s agy-trace \
  "cd '$repo_root' && CODEIUM_VMODULE='*=5' agy --add-dir '$repo_root' --dangerously-skip-permissions --log-file '$work_dir/interactive.log'"
tmux send-keys -t agy-trace 'Reply exactly: ANTIGRAVITY_INTERACTIVE_TRACE_OK' Enter
# After the marker response completes:
tmux kill-session -t agy-trace
AGY_CAPTURE_MODE=interactive node antigravity/misc/scripts/extract-antigravity-log.cjs \
  "$work_dir/interactive.log" "$out_dir"
```

Compare the scratch output before replacing committed artifacts. Preserve exact prompt and `request.tools[]` content, but ignore log line numbers and other trace-only provenance when deciding whether a schema changed. Raw verbose logs remain uncommitted and must be reviewed for sensitive or machine-specific data.
