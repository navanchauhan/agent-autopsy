# Claude Code

## Capture method

Claude Code is captured by preloading `trace-claude-messages.cjs` into the native Bun binary and recording the real Anthropic `/v1/messages` request. The preload forwards the original request unchanged and redacts authentication headers before writing trace records.

Non-interactive and interactive requests are captured separately because prompts, eager tools, and steering can differ by model and mode.

## Non-interactive capture

Capture each explicitly supported model into a scratch trace directory:

```bash
repo_root=$PWD
scratch_root=${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}
mkdir -p "$scratch_root/claude-code/raw"
trace_dir=$(mktemp -d "$scratch_root/claude-code/raw/headless.XXXXXX")
models=(
  claude-fable-5
  claude-haiku-4-5-20251001
  claude-opus-4-7
  claude-opus-4-8
  claude-sonnet-4-6
  claude-sonnet-5
)

for model in "${models[@]}"; do
  CLAUDE_TRACE_DIR="$trace_dir" \
  BUN_OPTIONS="--preload=$repo_root/claude-code/misc/scripts/trace-claude-messages.cjs" \
  claude -p "Reply exactly: TRACE_FETCH_${model}" \
    --model "$model" --output-format json --no-session-persistence \
    --exclude-dynamic-system-prompt-sections --strict-mcp-config --tools default
done
```

There is no checked-in non-interactive extractor. Normalize and merge these records using the same harness-variable and exact-schema variant rules as the interactive extractor, without modifying interactive artifacts.

## Interactive capture

```bash
repo_root=$PWD
scratch_root=${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}
mkdir -p "$scratch_root/claude-code/raw"
trace_dir=$(mktemp -d "$scratch_root/claude-code/raw/interactive.XXXXXX")
out_dir="$scratch_root/claude-code/candidate"

CLAUDE_TRACE_DIR="$trace_dir" \
BUN_OPTIONS="--preload=$repo_root/claude-code/misc/scripts/trace-claude-messages.cjs" \
claude --dangerously-skip-permissions --strict-mcp-config --tools default

node claude-code/misc/scripts/extract-claude-trace.cjs "$trace_dir" "$out_dir"
```

In the interactive session, send `Reply exactly: CLAUDE_INTERACTIVE_TRACE_OK`, wait for the response, and exit before extraction. Merge the scratch interactive output with the existing non-interactive archive; do not replace the directory wholesale.

## Active limitations

- `extract-claude-trace.cjs` is interactive-only and labels its output accordingly; never point it at a non-interactive trace.
- `DesignSync` and `SendMessage` have been named by deferred-tool metadata, but their schemas have not been captured.
- Steering blocks can include locally configured agents, skills, Git state, and other host context. Retain representative product-owned structure and normalize or exclude machine-specific entries.

Never commit trace records or token-bearing headers.
