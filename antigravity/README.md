# Antigravity CLI

## Capture method

Antigravity is captured from the installed `agy` binary. A mitmproxy addon records the real request body sent to `streamGenerateContent` without headers, plus response status, completion, response-marker, byte-count, and body-digest evidence; `extract-antigravity-log.cjs` rejects incomplete or unsuccessful captures and extracts the system prompt and Gemini function declarations. Keep a parallel `CODEIUM_VMODULE='*=5'` log to verify the endpoint and response model versions, but do not use its `Cortex API Request` line when the logger truncates a large payload.

Automation installs the exact Linux tarball from Antigravity's live platform manifest and verifies its published SHA-512 before capture. That manifest is authoritative for the current release but exposes no public first-party version history. When the recorded version lags, the resolver also inspects Homebrew cask history only to discover possible intermediate official Google Cloud Storage URLs; each candidate must match the cask's Linux SHA-256 and is independently SHA-512 hashed before it can enter the release queue.

Both non-interactive and interactive modes are retained because their prompt framing may differ.

## Refresh

Use the checked-in wrapper to run both modes into the same scratch candidate,
with independent bounded proxies and a tmux PTY for interactive mode:

```sh
CAPTURE_SCRATCH_DIR="${CAPTURE_SCRATCH_DIR:-$PWD/.capture-scratch}" \
  bash .github/scripts/capture-antigravity.sh
```

The wrapper requires `agy`, `mitmdump`, `tmux`, `jq`, `node`, and GNU
coreutils (`timeout` and `realpath`), plus a valid Antigravity login in the
normal CLI auth location. It runs the unattended interactive capture in an
isolated scratch workspace and exits nonzero unless both
mode responses are successful, complete, and contain their requested markers.
Startup, command, and response bounds can be adjusted with the environment
variables listed by `bash .github/scripts/capture-antigravity.sh --help`.

Compare the scratch output before replacing committed artifacts. Preserve exact prompt and `request.tools[]` content, but ignore log line numbers and other trace-only provenance when deciding whether a schema changed. Raw verbose logs and request bodies remain uncommitted and must be reviewed for sensitive or machine-specific data.

## Release-discovery limitation

When it is reachable and valid, the current manifest exposes the newest observable Antigravity release. Historical backfill is best-effort because Homebrew is a secondary discovery source and may lag or omit a version; validating a discovered official artifact does not turn that source into a complete first-party release index. The automation therefore does not claim it can recover every release that appeared and disappeared between polls.
