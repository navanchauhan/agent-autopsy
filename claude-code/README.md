# Claude Code

## Capture method

Claude Code 2.1.296 is captured by recording the real Anthropic `/v1/messages` requests through an HTTPS proxy (`mitmdump` with `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`). Since 2.1.283, API calls bypass `globalThis.fetch`, so the `trace-claude-messages.cjs` preload no longer sees them. Raw flows stay in private evidence; credential headers are redacted before they reach disk.

The target runs in an isolated `HOME` with no user agents, skills, MCP servers, or settings, inside a small Git repository. Non-interactive (`claude -p`) requests are captured for every model the `/model` picker offers by default: Sonnet 5.5 (default), Opus 5.5, Haiku 5.5, and Fable 5.1. Interactive requests are captured from the TUI in tmux on the default model, together with the session-title and prompt-suggestion requests.

Since 2.1.271, follow-up turns continue a server-side thread (`thread: {type: "continue"}`) and carry only deltas, so full prompts come from each thread's first request. Expanded deferred-tool schemas come from the follow-up request after ToolSearch loads every listed deferred tool.

### Artifact layout

- `prompts/<model>.md` joins the request's `system` blocks in order with blank lines.
- `misc/<model>-steering.md` holds the message blocks that precede the user's own prompt. At 2.1.296 the environment, model, deferred-tool, agent-type, and skill listings arrive in a mid-conversation `role: system` message. Its block is marked with a `<!-- role: system -->` line, which is not product text.
- `misc/claude-haiku-5-5-session-title-message.md` holds the session-title user-message wrapper and, after a marker comment, the `output_config.format` schema.
- `misc/prompt-suggestion.md` holds the instruction the TUI appends to a copy of the main thread to predict the user's next input.

## Automated capture

The hourly resolver enumerates every stable version that npm publishes for `@anthropic-ai/claude-code` above the recorded version, so several releases between polls cannot collapse into only the newest one. The native `downloads.claude.ai/claude-code-releases/latest` pointer is the upper bound. Each version is queued only when its signed `manifest.json` gives a valid `linux-x64` SHA-256 checksum, and validated releases join the durable per-provider FIFO of capture targets in order.

The checked-in wrapper below still relies on the preload trace, so it does not see API traffic from 2.1.283 onward. Use it only for older releases until it is moved to the proxy:

```bash
CAPTURE_SCRATCH_DIR="${CAPTURE_SCRATCH_DIR:-$PWD/.capture-scratch}" \
  bash .github/scripts/capture-claude-code.sh
```

The wrapper:

- stops immediately if a no-tools authentication probe fails;
- proves the interactive login and first-run state before spending headless model turns;
- discovers the accepted model aliases from the captured tool schemas and resolves each alias through a successful request, so a new exact model ID does not depend on an embedded list;
- captures the base and deferred-tool requests for every supported headless model, with three models in flight by default;
- discovers deferred tool names from the actual base request's deferred-tool `<system-reminder>` and merges them with the bounded baseline inventory before requesting expansion;
- gives incomplete headless model work two bounded attempts by default (at most three), while revalidating and reusing successful base or deferred traces within the same run;
- requires successful response completion for each marker and a successful session-title request;
- pre-seeds onboarding and trust for the isolated `/workspace`, starts interactive Claude in non-bypass `dontAsk` mode inside tmux through the documented `claude "query"` initial-prompt interface, and requires a completed base trace before sending any deferred-tool turn;
- kills its tmux session on success, failure, timeout, or interruption; and
- runs `extract-claude-trace.cjs` against the interactive trace after copying the tracked archive into the scratch candidate directory.

Raw evidence is written only below `$CAPTURE_SCRATCH_DIR/claude-code/raw/`. The merged interactive candidate is written to `$CAPTURE_SCRATCH_DIR/claude-code/candidate/`.

The model and deferred-tool inventories come from current request evidence. For focused troubleshooting, the following bounded overrides are available:

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

- The bounded retry is local to one capture run; durable exact-plan capture and retry caches decide whether a later workflow run needs another fresh capture.
- Steering blocks can include locally configured agents, skills, Git state, and other host context. Retain representative product-owned structure and normalize or exclude machine-specific entries.

Never commit trace records or token-bearing headers.
