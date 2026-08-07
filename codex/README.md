# Codex

## Source method

Codex is open source, so its artifacts are extracted directly from the upstream source tree. There is no binary tracing, proxying, or live model request in this capture flow. Automated refreshes enumerate stable `@openai/codex` package versions newer than the archive and queue each one only when its exact `rust-v<version>` release tag is available; arbitrary commits on upstream `HEAD` do not trigger releases.

The Codex release being archived is separate from the Codex CLI that drives normalization. The provider worker treats the exact released source as evidence and spends no model tokens. The later serial author and read-only reviewer use the repository's last approved Codex CLI, so a newly released or broken package cannot break every provider's refresh.

`references/codex` is an ignored working clone. Prompt and runtime-message paths can move between revisions, so locate current definitions by distinctive text and verify how the source assembles them before updating this archive.

## Refresh

```sh
FORCE_CODEX_SYNC=1 bash .github/scripts/sync-codex-reference.sh
git -C references/codex rev-parse HEAD
```

Compare the new revision with the `revision` in `codex/VERSION`, then inspect the source definitions behind the existing `prompts/`, `tools/`, and `misc/` artifacts. Preserve exact model-facing text and schema structure. Replace only runtime values with harness variables, and keep configuration-dependent schema differences as variants.

## Scope

- GPT-5.6 models use `code_mode_only`; their per-session code-mode tool listing is assembled dynamically and is not represented as a fixed file under `tools/`.
- `misc/guardian-policy.md` records the assembled default Guardian policy; managed tenant policy text can replace its `Policy Configuration` section at runtime.
- Model-catalog `collaboration_modes.default` and `collaboration_modes.plan` messages can replace the corresponding configuration-provided collaboration instructions; absent catalog values fall back to configuration, while explicit empty values suppress the legacy text.
- Realtime clients can replace the bundled entry and exit instructions per conversation through `realtime_start_instructions` and `realtime_end_instructions`.
- The two fixed multi-agent mode messages are archived; custom mode passes configuration-provided text through unchanged and has no fixed prompt artifact.

The source revision and current model-mode metadata belong in `VERSION`; release history belongs in Git.
