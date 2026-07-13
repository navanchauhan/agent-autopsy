# Grok CLI

## Capture method

Grok is a native Rust CLI whose model-facing requests are not available in its local session export. Tool schemas are therefore captured from the real SSE request to `https://cli-chat-proxy.grok.com/v1/responses` through mitmproxy.

`mitm-capture-grok.py` records requests to a scratch JSONL file and redacts authentication-shaped request and response headers. `extract-grok-capture.cjs` groups requests by model and mode, writes system prompts and steering, and preserves exact `tools[]` entries or variants.

The archive covers default Grok 4.5 in non-interactive and interactive modes, Composer 2.5 Fast, and the session-title request.

## Refresh

Keep one proxy alive for all modes, then extract into scratch space:

```sh
repo_root=$PWD
scratch_root=${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}
mkdir -p "$scratch_root/grok/raw"
work_dir=$(mktemp -d "$scratch_root/grok/raw/run.XXXXXX")
capture_file="$work_dir/capture.jsonl"
out_dir="$scratch_root/grok/candidate"

mitmdump --listen-port 8899 -s grok/misc/scripts/mitm-capture-grok.py \
  --set grok_capture_out="$capture_file" &
mitm_pid=$!
trap 'kill "$mitm_pid" 2>/dev/null || true' EXIT
sleep 2

( cd "$work_dir" && \
  HTTPS_PROXY=http://127.0.0.1:8899 https_proxy=http://127.0.0.1:8899 \
  SSL_CERT_FILE="$HOME/.mitmproxy/mitmproxy-ca-cert.pem" \
  grok -p 'Reply exactly: GROK_TRACE_OK' --output-format json )

( cd "$work_dir" && \
  HTTPS_PROXY=http://127.0.0.1:8899 https_proxy=http://127.0.0.1:8899 \
  SSL_CERT_FILE="$HOME/.mitmproxy/mitmproxy-ca-cert.pem" \
  grok -p 'Reply exactly: GROK_COMPOSER_TRACE_OK' \
    --model grok-composer-2.5-fast --output-format json )

tmux new-session -d -s grok-trace \
  "cd '$work_dir' && HTTPS_PROXY=http://127.0.0.1:8899 https_proxy=http://127.0.0.1:8899 SSL_CERT_FILE='$HOME/.mitmproxy/mitmproxy-ca-cert.pem' grok --always-approve"
tmux send-keys -t grok-trace 'Reply exactly: GROK_INTERACTIVE_TRACE_OK' Enter
# After the marker response completes:
tmux kill-session -t grok-trace

kill "$mitm_pid"
wait "$mitm_pid" 2>/dev/null || true
trap - EXIT
node grok/misc/scripts/extract-grok-capture.cjs "$capture_file" "$out_dir"
```

Compare scratch output before updating the archive. Normalize workspace, date, shell, user-query, and repeated skill-list values. Exclude locally installed skills, MCP reminders, and other host state unless they are demonstrably bundled by Grok.

## Security and limitations

- Never use `grok --debug-file` for capture; it can print the live OAuth token.
- The addon redacts authentication-shaped request and response headers, but raw JSONL still contains model traffic. Keep it in scratch space, inspect it for secrets, and never commit it.
- `grok trace` is insufficient for this archive because it omits the request-level `tools[]` schemas.
