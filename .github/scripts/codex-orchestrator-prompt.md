You are orchestrating today's scheduled refresh of the `agent-autopsy` repository
(a public repo documenting captured system prompts and tool schemas from several
coding-agent CLIs). You are running non-interactively inside a disposable CI
container that already has git/gh/tmux/mitmproxy/node and all four CLIs
installed and updated to their current latest versions.

## Step 1 — read what changed

Read the JSON file at `$CHANGED_TOOLS_FILE` (an array of
`{"tool","dir","old_version","new_version"}` objects — one entry per tool whose
installed version no longer matches what's recorded in `<dir>/VERSION`). If the
array is empty, do nothing else — your final message should just say no tools
changed today.

## Step 2 — spawn one subagent per changed tool

Prefer multiple sub-agents to parallelize this work; once they're running, your
job is to coordinate them, not to do their work yourself. For each entry in the
changed-tools list, spawn one subagent and give it:

- The tool's directory (`<dir>/`) and its `README.md`, which documents the exact
  "Refresh commands" for that tool (non-interactive `--print`/`-p` capture, and
  a tmux-driven interactive capture — most tools document both; run **both**,
  not just one, exactly as written there).
- Its `VERSION` file, showing the old recorded version/capture state and the
  existing conventions for what fields to update.
- Instructions to:
  1. Run the documented capture commands into a scratch directory (do not
     write into `<dir>/prompts`, `<dir>/tools`, or `<dir>/misc` directly yet).
  2. Diff the freshly captured output against what's currently committed.
     Only touch files whose *content* actually changed — ignore pure
     provenance/trace-line-number/timestamp churn that some extraction
     scripts embed.
  3. Rewrite exactly the files that changed, and update `<dir>/VERSION` and
     `<dir>/README.md` with the new version number and clear prose notes
     describing *what* changed and *why it matters* (new/removed tools,
     prompt wording changes, schema changes) — follow the level of detail
     already present in that file's existing notes (e.g. the `tool_notes`/
     `capture_fixes` style already used across this repo).
  4. If a capture step fails, or hits a dead end (see `ampcode/README.md` for
     the precedent of documenting an exhausted capture path rather than
     silently failing), write that down clearly in `VERSION`/`README.md`
     instead of crashing, and move on — one tool's failure must not block
     the others.
  5. Never run `git add`/`git commit`/`git push` — that is the wrapper
     script's job, not yours or your subagents'.
  6. Never fabricate a URL, version number, or tool schema. Never print full
     credential/token file contents anywhere. Do not weaken or remove any
     existing auth-redaction logic in the capture/extraction scripts.

Wait for all subagents to finish before continuing, unless something needs a
human decision — if so, stop and clearly say what's blocked instead of
guessing.

## Step 3 — final report

As your last message, write one short section per tool that had a real content
change, each shaped as a ready-to-use git commit (a one-line subject in this
repo's existing style — `Update <tool> captures to <new_version>` — followed
by 2-4 sentences describing what changed). For any tool that only had a
version-string bump with no real content change, say so explicitly in one
sentence instead of writing a commit-shaped section for it. This final message
is parsed programmatically, so keep it to exactly one section per changed-tool
entry, in the same order as `$CHANGED_TOOLS_FILE`, with a `## <tool>` heading
per section.
