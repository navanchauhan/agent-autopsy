# Public-source inventory: Codex

Checked 2026-11-24 UTC. This is a bounded source inspection, not a live
session capture or a complete revalidation of the archive. The existing
`VERSION` and `SURFACES.json` describe the earlier archive and are not advanced
by this check.

- **Release observed:** [`rust-v0.172.0`](https://github.com/openai/codex/releases/tag/rust-v0.172.0), commit `3d86e43b075adeba2193ec5c22ac92f55afd82e6`, resolved from the public Git tag. The GitHub latest-release API and npm package version both reported 0.172.0.
- **Prompt, documented in source:** the tag contains the [GPT-5 Codex prompt template](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/core/gpt_5_codex_prompt.md). Its presence does not establish which prompt a particular session receives.
- **Tool, documented in source:** [`apply_patch`](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/core/src/tools/handlers/apply_patch_spec.rs) has a freeform Lark grammar, with an optional environment ID depending on configuration. The [grammar](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/core/assets/tools/apply_patch.lark) is separately defined.
- **Not verified:** the complete assembled prompt, model catalog, and enabled tool schemas for this release or any live session. Dynamic and configuration-dependent surfaces cannot be inferred from the two files above. Existing artifacts have not been checked for equivalence to this release.
