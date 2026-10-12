# Refresh automation

`agentic-refresh.yml` keeps each provider current. It has three parts.

**Plan (deterministic).** `.github/agentic/plan.sh` resolves each provider's
newest stable release and the exact artifact digest to pin. It reads Claude's
signed manifest, the Antigravity updater's SHA-512, the npm registry, and source
tags. Grok publishes no checksum, so the digest of the served bytes is pinned
instead. Releases between the recorded version and the newest are skipped.

**Refresh (one agent per provider).** A pinned image contains the target
release, the Claude Code driver, mitmproxy, tmux, and binutils. Claude Opus 5.5
gets a short goal (`.github/agentic/goal.md`) and a provider spec
(`.github/agentic/providers/<provider>.yaml`). It records the release's real
traffic and reads its binary or source to find and confirm every surface. It
then writes the provider directory. Around the agent, trusted code:

- gives the agent a copy of the repository with no `.git`, and copies back only
  the provider directory as plain files;
- writes the pinned digests, evidence digest, artifact hashes, counts, and
  `CATALOG.md`;
- runs `.github/agentic/validate.cjs`, which checks scope, file types, JSON,
  token patterns and literal secret values, the release field, and the surface
  registry.

A second agent then reviews the candidate read-only, against the raw evidence
and the release itself. It must attest that the candidate is free of PII and
secrets and backed by evidence. Validation errors and review issues go back to
the author, up to three attempts. Rotated provider logins are saved to the
environment afterwards.

**Publish.** Each approved provider patch becomes one commit on a fresh
checkout and is validated again. `publish: branch` pushes a review branch.
`publish: release` commits to the default branch and creates a dated tag and
release.

Raw captures and agent transcripts stay on the runner and are never logged or
uploaded, because the repository is public. Only approved patches, summaries,
and review notes leave the job.

To change what gets captured, edit the goal or a provider spec rather than code.
Specs hold only facts an agent cannot cheaply rediscover.

The older `daily-refresh.yml` pipeline shares a concurrency group with this
workflow, so the two never use rotating provider logins at the same time.
