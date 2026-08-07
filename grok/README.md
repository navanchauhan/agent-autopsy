# Grok CLI

## Capture method

Grok Build is open source at `xai-org/grok-build`. Inspect that source first for bundled prompt and tool construction; use a real SSE request to `/v1/responses` only for server-provided request content and runtime verification. OAuth sessions use `cli-chat-proxy.grok.com`, while API-key sessions use `api.x.ai`.

The automated resolver uses the stable pointer as the upper bound, enumerates versioned changelogs in the public mirror, and binds each release to the commit that added its changelog. It records that commit's `SOURCE_REV` and hashes the exact official Linux binary. The mirror can batch adjacent binary releases into one source snapshot, so multiple versions may intentionally share a mirror commit and a later crate version; the version-specific changelog and binary digest remain exact. The isolated capture home sets `[cli] auto_update = false` so that binary cannot swap itself after preflight.

`mitm-capture-grok.py` records requests to a scratch JSONL file, omits authentication-shaped request and response headers, and records response status, completion, response-marker, byte-count, and body-digest evidence. `extract-grok-capture.cjs` rejects incomplete or unsuccessful required modes, groups requests by model and mode, writes system prompts and steering, and preserves exact `tools[]` entries or variants.

The archive covers default Grok 4.5 in non-interactive and interactive modes plus the session-title request.

## Refresh

Use the checked-in wrapper to run one bounded proxy across all modes, drive the
interactive CLI through a tmux PTY, verify successful response markers, and
extract into scratch space:

```sh
CAPTURE_SCRATCH_DIR="${CAPTURE_SCRATCH_DIR:-$PWD/.capture-scratch}" \
  bash .github/scripts/capture-grok.sh
```

The wrapper requires `grok`, `mitmdump`, `tmux`, `jq`, `node`, and GNU
coreutils (`timeout` and `realpath`), plus a valid Grok login in the normal CLI
auth location. It exits nonzero unless the
non-interactive and interactive responses are successful and contain their
requested markers and a completed session-title response is captured. Startup,
command, and response bounds can be adjusted with the environment variables
listed by `bash .github/scripts/capture-grok.sh --help`.

Compare scratch output before updating the archive. Normalize workspace, date, shell, user-query, and repeated skill-list values. Exclude locally installed skills, MCP reminders, and other host state unless they are demonstrably bundled by Grok.

## Security and limitations

- Never use `grok --debug-file` for capture; it can print the live OAuth token.
- The addon omits authentication-shaped request and response headers, but raw JSONL still contains model traffic. Keep it in scratch space, inspect it for secrets, and never commit it.
- `grok trace` is insufficient for this archive because it omits the request-level `tools[]` schemas.
