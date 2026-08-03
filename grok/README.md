# Grok CLI

## Capture method

Grok Build is open source at `xai-org/grok-build`. Inspect that source first for bundled prompt and tool construction; use real inference requests only for server-provided request content and runtime verification. Current builds can select `/v1/responses` or `/v1/chat/completions`, and the capture must follow the endpoint actually selected by the installed binary. OAuth sessions use `cli-chat-proxy.grok.com`, while API-key sessions use `api.x.ai`.

`mitm-capture-grok.py` records response-backed requests for both inference endpoints to a scratch JSONL file and redacts authentication-shaped request and response headers. `extract-grok-capture.cjs` rejects request-only evidence, groups requests by model and mode, writes system prompts and steering, and preserves exact `tools[]` entries or variants.

The archive covers default Grok 4.5 in non-interactive and interactive modes plus the session-title request.

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
  grok -p 'Reply exactly: GROK_TRACE_OK' --output-format json \
  >"$work_dir/non-interactive.log" 2>&1 )

tmux new-session -d -s grok-trace \
  "cd '$work_dir' && HTTPS_PROXY=http://127.0.0.1:8899 https_proxy=http://127.0.0.1:8899 SSL_CERT_FILE='$HOME/.mitmproxy/mitmproxy-ca-cert.pem' grok --always-approve"
tmux send-keys -t grok-trace 'Reply exactly: GROK_INTERACTIVE_TRACE_OK' Enter
for _ in $(seq 1 90); do
  tmux capture-pane -p -t grok-trace -S -1000 >"$work_dir/interactive.log"
  grep -q 'GROK_INTERACTIVE_TRACE_OK' "$work_dir/interactive.log" && break
  sleep 1
done
grep -q 'GROK_INTERACTIVE_TRACE_OK' "$work_dir/interactive.log"
tmux kill-session -t grok-trace

kill "$mitm_pid"
wait "$mitm_pid" 2>/dev/null || true
trap - EXIT
node grok/misc/scripts/extract-grok-capture.cjs "$capture_file" "$out_dir"
```

Do not substitute an ad-hoc direct-request helper when proxy capture fails. A
publishable record must come from the installed CLI and contain an integer
`response_status`; request bodies without response evidence are diagnostic only.
If any required mode lacks response-backed evidence, leave `grok/` completely
unchanged so independently approved tool updates can still publish.

Compare scratch output before updating the archive. Normalize workspace, date, shell, user-query, and repeated skill-list values. Exclude locally installed skills, MCP reminders, and other host state unless they are demonstrably bundled by Grok.

## Security and limitations

- Never use `grok --debug-file` for capture; it can print the live OAuth token.
- The addon redacts authentication-shaped request and response headers, but raw JSONL still contains model traffic. Keep it in scratch space, inspect it for secrets, and never commit it.
- `grok trace` is insufficient for this archive because it omits the request-level `tools[]` schemas.
