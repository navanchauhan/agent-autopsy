# Grok CLI

Grok (`~/.grok/bin/grok`) is xAI's coding agent CLI ("Grok Build"). It ships as a
single native Rust/Mach-O binary — not open source, and not a Bun/Node process
like Claude Code or Amp — so these artifacts were extracted from the installed
binary's real network traffic rather than from source.

## Capture method

`grok trace <session-id> --local -o <file>` (Grok's own built-in session-export
subcommand) turns out to export a rich per-session bundle (`system_prompt.txt`,
`chat_history.jsonl`, `prompt_context.json`, `events.jsonl`, ...), but none of
it includes the exact `tools[]` JSON Schemas the client actually sends to the
model — that array is assembled fresh per request and isn't part of the
persisted session state. So the tool schemas here come from a network-level
capture instead:

1. `grok` respects the standard `HTTPS_PROXY`/`https_proxy` env vars and, when
   `SSL_CERT_FILE` points at a locally-trusted CA, does not pin the model
   endpoint's TLS certificate — a local [mitmproxy](https://mitmproxy.org)
   instance can terminate and see the plaintext request.
2. `grok agent`'s `--xai-api-base-url` / `--cli-chat-proxy-base-url` flags
   confirmed the client talks to `https://cli-chat-proxy.grok.com/v1/responses`,
   an xAI-hosted proxy in front of an OpenAI-"Responses"-API-shaped endpoint
   (`{model, input: [...], tools: [...], reasoning: {...}, stream: true}`,
   returned as an SSE stream of `response.*` events).
3. `grok/misc/scripts/mitm-capture-grok.py` is a mitmproxy addon that watches
   for requests to `cli-chat-proxy.grok.com`/`grok.com`, redacts the
   `Authorization` (and other auth-shaped) headers to `***`, and appends one
   redacted JSON record per request/response to a JSONL file — the same
   redaction discipline as `claude-code/misc/scripts/trace-claude-messages.cjs`.
4. `grok/misc/scripts/extract-grok-capture.cjs` turns that JSONL into this
   directory's `prompts/`, `tools/`, and `misc/` layout: it groups captured
   `/v1/responses` request bodies by run kind (model + interactive vs.
   non-interactive vs. session-title, detected from the system message text),
   writes the `system`-role message to `prompts/`, the remaining synthetic
   `user`-role messages (cwd/OS/shell info, the skills-listing
   `<system-reminder>`, and the final `<user_query>`) to `misc/*-steering.md`
   with `<harnessVariable>` placeholders, and merges every observed `tools[]`
   entry into `tools/<name>.json` (`variants[]` when a tool's exact schema
   differs by run kind, e.g. `update_goal`).

`grok trace` and `grok --debug`/`--debug-file` were both explored first and
ruled out as the primary source: the trace bundle's `chat_history.jsonl` has
message *content* but not the request-level `tools[]` schemas, and
`--debug-file` logs are far noisier and, worse, print the live xAI OAuth
bearer token (`SamplerConfig { api_key: Some("eyJ...") }`) in plaintext — that
token was never written into any file in this repo and the debug log used to
discover this was deleted immediately after.

Interactive captures were driven the same way as claude-code/antigravity: a
tmux session running `grok --always-approve` (proxied the same way) fed a
prompt with `tmux send-keys`.

Two distinct models were captured: the default `grok-4.5` and
`grok-composer-2.5-fast` (Cursor's Composer model, routed through Grok CLI —
`grok models` lists it as "Cursor's latest coding model"). They have
completely different system prompts and tool sets (`run_terminal_command`,
`read_file`, ... vs. `Shell`, `Read`, `StrReplace`, ...); `grok-4.5` was
captured in both non-interactive (`-p`) and interactive (tmux) modes, which
turned out to share the exact same 27 tool schemas but a slightly different
system prompt (interactive framing, plus an extra `<user_guide>` section).
The session-title generator (fired once per session, on a `grok-build` model
alias, to name it in `grok sessions`) is captured as its own minimal prompt.

## Contents

- `prompts/` — the four captured system-role prompts: `grok-4.5.md`
  (non-interactive/headless framing), `grok-4.5-interactive.md` (interactive
  TUI framing, includes a `<user_guide>` section the headless one lacks),
  `grok-composer-2.5-fast.md` (a completely different, Cursor-Composer-branded
  system prompt), and `grok-session-title.md`. Run-specific scalar values are
  marked with `<harnessVariable>{{name=example}}</harnessVariable>`; repeated
  runtime sections use `{{#each collectionName}}...{{/each}}` blocks.
- `tools/` — one JSON file per observed `tools[]` entry (47 total: 27 for
  `grok-4.5`, 20 for `grok-composer-2.5-fast`, 1 shared `update_goal` with
  per-model variants, plus `session_title`). Each file's `schema` is the exact
  object from the request's `tools[]` array (`{"type":"function","name":...,
  "parameters":{...},"description":...}` for function tools, or
  `{"type":"web_search"}`/`{"type":"x_search"}` for xAI's two built-in
  backend-search tools). Two tool names collide only by case across models
  (`grep`/`Grep`, `write`/`Write`) — the Composer-model file gets a
  `-grok-composer-2.5-fast` suffix so both survive on case-insensitive
  filesystems.
- `misc/` — the non-system input messages (cwd/OS/shell `<user_info>`, the
  skills-listing `<system-reminder>`, and the final `<user_query>`) captured
  alongside each non-session-title prompt, plus the two capture/extraction
  scripts under `misc/scripts/`.
- `VERSION` — binary version/checksum, capture commands, and prompt/tool/misc
  counts.

## Refresh notes

The 0.2.99 capture keeps all four system prompts and the 47-tool inventory from
0.2.93. It adds explicit model selection to the `spawn_subagent` schema, makes
Composer's `Task` model fallback/resume behavior clearer, and removes the old
`read_file` promise that lines over 2,000 characters are truncated. Composer's
steering also advertises two new first-party bundled skills, `build-with-ai`
and `design`; host-specific Linux fields, locally installed skills, and the
capture machine's `tasks` MCP reminder remain excluded.

## Refresh commands

Non-interactive capture (repeat with `--model grok-composer-2.5-fast` for the
Composer prompt/tools):

```sh
work_dir=$(mktemp -d /tmp/grok-work.XXXXXX)
mitmdump --listen-port 8899 -s grok/misc/scripts/mitm-capture-grok.py \
  --set grok_capture_out="$work_dir/capture.jsonl" &
mitm_pid=$!
sleep 2
( cd "$work_dir" && HTTPS_PROXY=http://127.0.0.1:8899 https_proxy=http://127.0.0.1:8899 \
  SSL_CERT_FILE="$HOME/.mitmproxy/mitmproxy-ca-cert.pem" \
  grok -p "Reply exactly: GROK_TRACE_OK" --output-format json )
kill "$mitm_pid"
node grok/misc/scripts/extract-grok-capture.cjs "$work_dir/capture.jsonl" grok
```

Interactive capture (same proxy instance, driven via tmux):

```sh
tmux new-session -d -s grok-trace \
  "cd $work_dir && HTTPS_PROXY=http://127.0.0.1:8899 https_proxy=http://127.0.0.1:8899 \
   SSL_CERT_FILE=$HOME/.mitmproxy/mitmproxy-ca-cert.pem grok --always-approve"
tmux send-keys -t grok-trace 'Reply exactly: GROK_INTERACTIVE_TRACE_OK' Enter
```

`mitmdump`'s CA (`~/.mitmproxy/mitmproxy-ca-cert.pem`) is generated on first
run of any mitmproxy tool and is not itself sensitive, but nothing about the
live xAI OAuth token in `~/.grok/auth.json` should ever be captured, logged,
or committed — the addon redacts `Authorization`/`Cookie`/etc. headers before
anything touches disk.
