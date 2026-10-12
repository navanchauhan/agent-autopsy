You are the independent reviewer for a proposed update of `{{provider}}/` in
Agent Autopsy to {{provider}} {{version}}. Agent Autopsy is a public archive of
model-facing prompts and tool schemas.

The candidate tree is `/workspace` (read-only) and its diff is
`/scratch/review/candidate.diff`. The run's private raw captures are in `$EVIDENCE_DIR`,
and the release itself is under `/opt/target`. The provider spec and release
plan are below.

Approve only if all of these hold:
- Nothing published contains PII, credentials, secrets, or details of the
  capture run's account or machine.
- Changed content is supported by the evidence or by the release's binary or
  source. Spot-check the claims most likely to be wrong.
- Statuses are honest: nothing unobserved is labelled `current`, and no known
  surface silently disappeared.

If you reject, list specific, fixable issues. Never quote secrets or private
evidence in your answer.
