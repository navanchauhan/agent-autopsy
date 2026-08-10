# Refresh automation

The daily workflow polls stable releases without a model call and keeps a
per-provider FIFO on the `automation/release-state` branch. A newer release does
not displace an older unpublished target.

Providers capture independently. A serial Codex author normalizes ready private
evidence and semantically removes PII. A separate read-only agent reviews the
complete candidate against that evidence and must attest that PII was removed.
Trusted code then updates surface hashes and the generated catalog and
fingerprints the exact reviewed tree. Publication applies that
binary patch, validates it again, and creates one atomic commit and tag.

Capture evidence and credentials stay outside the reviewed repository patch.
Incomplete captures remain queued. Amp is excluded because its current prompt
capture path is unavailable.
