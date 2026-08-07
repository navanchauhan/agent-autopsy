# Claude Code

## Capture method

Claude Code is captured by preloading `trace-claude-messages.cjs` into the native Bun binary and recording the real Anthropic `/v1/messages` request. The preload forwards the original request and response unchanged, redacts authentication headers, and records only response status/completion metadata; response bodies are inspected for terminal SSE events but are never retained.

Non-interactive and interactive requests are captured separately because prompts, eager tools, and steering can differ by model and mode.

The hourly resolver enumerates stable package versions newer than the archive, bounds them by Claude Code's native `latest` pointer, and requires the Linux checksum from each exact native release manifest before queueing it. Multiple validated releases observed between polls remain separate FIFO targets.

## Automated capture

Use the checked-in wrapper for both modes:

```bash
CAPTURE_SCRATCH_DIR="${CAPTURE_SCRATCH_DIR:-$PWD/.capture-scratch}" \
  bash .github/scripts/capture-claude-code.sh
```

The wrapper:

- stops immediately if a no-tools authentication probe fails;
- proves the interactive login and first-run state before spending headless model turns;
- captures the base and deferred-tool requests for every supported headless model, with three models in flight by default;
- discovers deferred tool names from the actual base request's deferred-tool `<system-reminder>` and merges them with the bounded baseline inventory before requesting expansion;
- gives incomplete headless model work two bounded attempts by default (at most three), while revalidating and reusing successful base or deferred traces within the same run;
- requires successful response completion for each marker and a successful session-title request;
- pre-seeds onboarding and trust for the isolated `/workspace`, starts interactive Claude in non-bypass `dontAsk` mode inside tmux through the documented `claude "query"` initial-prompt interface, and requires a completed base trace before sending any deferred-tool turn;
- kills its tmux session on success, failure, timeout, or interruption; and
- runs `extract-claude-trace.cjs` against the interactive trace after copying the tracked archive into the scratch candidate directory.

Raw evidence is written only below `$CAPTURE_SCRATCH_DIR/claude-code/raw/`. The merged interactive candidate is written to `$CAPTURE_SCRATCH_DIR/claude-code/candidate/`.

The supported model list and deferred-tool inventories live in the wrapper. For focused troubleshooting, the following bounded overrides are available:

```bash
CLAUDE_CAPTURE_MODELS="claude-sonnet-5" \
CLAUDE_CAPTURE_PARALLELISM=1 \
CLAUDE_HEADLESS_ATTEMPTS=2 \
CLAUDE_HEADLESS_TIMEOUT_SECONDS=120 \
CLAUDE_INTERACTIVE_TIMEOUT_SECONDS=180 \
  bash .github/scripts/capture-claude-code.sh
```

## Credentials

The wrapper assumes authentication has already been seeded. Headless `-p` mode accepts the static token produced by `claude setup-token` through `CLAUDE_CODE_OAUTH_TOKEN`. The wrapper explicitly carries that variable into the tmux session without placing its value in the tmux shell command.

The wrapper disables Claude's auto-updater during capture so the manifest-verified binary cannot replace itself after the version preflight.

Some Claude Code versions still require the normal interactive login state before opening the TUI. For those versions, perform a real login under an isolated `HOME`, store the resulting `.claude/.credentials.json` as a protected CI secret, and restore it to `$HOME/.claude/.credentials.json` with mode `0600` before running the wrapper. Copy the complete file rather than constructing its OAuth fields. It contains refreshable credentials, so a caller that seeds it must also persist the updated file after every attempted capture, including failed captures.

## Active limitations

- `extract-claude-trace.cjs` is interactive-only and labels its output accordingly; never point it at a non-interactive trace.
- There is no checked-in non-interactive extractor. Normalize the headless records using the same harness-variable and exact-schema variant rules as the interactive extractor, without replacing interactive artifacts.
- The bounded retry is local to one capture run; durable exact-plan capture and retry caches decide whether a later workflow run needs another fresh capture.
- Steering blocks can include locally configured agents, skills, Git state, and other host context. Retain representative product-owned structure and normalize or exclude machine-specific entries.

Never commit trace records or token-bearing headers.
