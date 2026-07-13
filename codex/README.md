# Codex

## Source method

Codex is open source, so its artifacts are extracted directly from the upstream source tree. There is no binary tracing, proxying, or live model request in this capture flow.

`references/codex` is an ignored working clone. Prompt and runtime-message paths can move between revisions, so locate current definitions by distinctive text and verify how the source assembles them before updating this archive.

## Refresh

```sh
FORCE_CODEX_SYNC=1 bash .github/scripts/sync-codex-reference.sh
git -C references/codex rev-parse HEAD
```

Compare the new revision with the `revision` in `codex/VERSION`, then inspect the source definitions behind the existing `prompts/`, `tools/`, and `misc/` artifacts. Preserve exact model-facing text and schema structure. Replace only runtime values with harness variables, and keep configuration-dependent schema differences as variants.

## Scope and active gaps

- GPT-5.6 models use `code_mode_only`; their per-session code-mode tool listing is assembled dynamically and is not represented as a fixed file under `tools/`.
- The Guardian action-risk policy prompt at `codex-rs/core/src/guardian/policy_template.md` is security-relevant but is not yet included in this archive.

The source revision and current model-mode metadata belong in `VERSION`; release history belongs in Git.
