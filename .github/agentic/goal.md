Agent Autopsy is a public archive of exactly what coding-agent CLIs send to
their models: system prompts, steering text, and tool schemas.

Goal: make `{{provider}}/` an accurate archive of {{provider}} {{version}}.

Read `docs/artifact-format.md`, the existing `{{provider}}/` files, and the
provider spec and release plan below. Then find out what this release actually
sends. Run it and record its traffic, and read its shipped binary or source. Use
each to check the other: requests show what is sent, and the binary shows what
exists but a run might not trigger.

Requirements:
- Every `current` surface is backed by something you observed at this release.
  Anything else gets an honest status (`stale`, `gap`, `dynamic`, ...) and a note.
- Published files contain no PII, credentials, secrets, or details of this run's
  account or machine. Runtime values become
  `<harnessVariable>{{name=example}}</harnessVariable>`.
- Raw captures stay in `$EVIDENCE_DIR`, never in the repository. Edit only
  `{{provider}}/`.
- The host computes digests, counts, and `CATALOG.md`. Before you finish, run
  `node .github/scripts/update-surface-hashes.cjs {{provider}}` and
  `node .github/scripts/validate-surfaces.cjs {{provider}}`. The second must pass.

Environment: the pinned release is installed under `/opt/target`. Do not
update it. `mitmdump -s /opt/agentic/record.py` records HTTPS flows into
`$EVIDENCE_DIR/http`. tmux, ripgrep, binutils, python3, node, git, and curl are
available. Provider credentials are already seeded. Use them only to run the
target.

Your final message is published as the change summary. Keep it short and
free of private data.
