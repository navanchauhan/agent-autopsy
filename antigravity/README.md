# Antigravity CLI

## Capture method

Antigravity is captured from the installed `agy` binary. A redacted mitmproxy addon records only the real request body sent to `streamGenerateContent`; `extract-antigravity-log.cjs` extracts its system prompt and Gemini function declarations. Keep a parallel `CODEIUM_VMODULE='*=5'` log to verify the endpoint and response model versions, but do not use its `Cortex API Request` line when the logger truncates a large payload.

Both non-interactive and interactive modes are retained because their prompt framing may differ.

## Refresh

Run both modes into the same scratch output directory:

```sh
repo_root=$PWD
scratch_root=${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}
mkdir -p "$scratch_root/antigravity/raw"
work_dir=$(mktemp -d "$scratch_root/antigravity/raw/run.XXXXXX")
out_dir="$scratch_root/antigravity/candidate"

mitmdump --listen-port 8898 -s antigravity/misc/scripts/mitm-capture-antigravity.py \
  --set antigravity_capture_out="$work_dir/non-interactive.jsonl" &
proxy_pid=$!
sleep 2
HTTPS_PROXY=http://127.0.0.1:8898 https_proxy=http://127.0.0.1:8898 \
  SSL_CERT_FILE="$HOME/.mitmproxy/mitmproxy-ca-cert.pem" CODEIUM_VMODULE='*=5' \
  agy --add-dir "$repo_root" \
  --print 'Reply exactly: ANTIGRAVITY_TRACE_OK' \
  --print-timeout 90s --log-file "$work_dir/non-interactive.log"
kill "$proxy_pid"
wait "$proxy_pid" 2>/dev/null || true
node antigravity/misc/scripts/extract-antigravity-log.cjs \
  "$work_dir/non-interactive.jsonl" "$out_dir"

mitmdump --listen-port 8898 -s antigravity/misc/scripts/mitm-capture-antigravity.py \
  --set antigravity_capture_out="$work_dir/interactive.jsonl" &
proxy_pid=$!
sleep 2
tmux new-session -d -s agy-trace \
  "cd '$repo_root' && HTTPS_PROXY=http://127.0.0.1:8898 https_proxy=http://127.0.0.1:8898 SSL_CERT_FILE='$HOME/.mitmproxy/mitmproxy-ca-cert.pem' CODEIUM_VMODULE='*=5' agy --add-dir '$repo_root' --dangerously-skip-permissions --log-file '$work_dir/interactive.log'"
tmux send-keys -t agy-trace 'Reply exactly: ANTIGRAVITY_INTERACTIVE_TRACE_OK' Enter
# After the marker response completes:
tmux kill-session -t agy-trace
kill "$proxy_pid"
wait "$proxy_pid" 2>/dev/null || true
AGY_CAPTURE_MODE=interactive node antigravity/misc/scripts/extract-antigravity-log.cjs \
  "$work_dir/interactive.jsonl" "$out_dir"
```

Compare the scratch output before replacing committed artifacts. Preserve exact prompt and `request.tools[]` content, but ignore log line numbers and other trace-only provenance when deciding whether a schema changed. Raw verbose logs and request bodies remain uncommitted and must be reviewed for sensitive or machine-specific data.
