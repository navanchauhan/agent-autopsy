# Public-source inventory: Codex

Checked 2026-11-24 UTC. This is a bounded source inspection, not a live
session capture or a complete revalidation of the archive. The canonical registry records 0.172.0 source updates and identifies retained 0.164.0 artifacts as stale.

- **Release observed:** [`rust-v0.172.0`](https://github.com/openai/codex/releases/tag/rust-v0.172.0), commit `3d86e43b075adeba2193ec5c22ac92f55afd82e6`, resolved from the public Git tag. The GitHub latest-release API and npm package version both reported 0.172.0.
- **Prompt, documented in source:** the tag contains the [GPT-5 Codex prompt template](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/core/gpt_5_codex_prompt.md). Its presence does not establish which prompt a particular session receives.
- **Tool, documented in source:** [`apply_patch`](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/core/src/tools/handlers/apply_patch_spec.rs) has a freeform Lark grammar, with an optional environment ID depending on configuration. The [grammar](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/core/assets/tools/apply_patch.lark) is separately defined.
- **Not verified:** the complete assembled prompt, model catalog, and enabled tool schemas for this release or any live session. Dynamic and configuration-dependent surfaces cannot be inferred from the two files above. See the canonical registry for the subset with verified equivalence.

## Broader source coverage

[The generated source index](PUBLIC-SOURCE-INDEX.md) enumerates the pinned tree's prompt and instruction paths and tool-related Rust modules, including registry, handlers, specs, helper and test candidates. The index is deliberately inclusive: a path is not proof of a shipped or active definition. Run `python3 codex/generate-public-index.py --check` against the pinned tag to reproduce it. Source-defined registrations are conditional; inspect the linked builders and registry for gates. Remote catalogs, dynamically supplied MCP tools and assembled runtime prompts are not captured.

Compared with archived source commit `6aaac694803004a63c6f393d153c96d22521a6b9`, the pinned tree changes the Guardian policy template and numerous tool handler files. The exact [source diff](https://github.com/openai/codex/compare/6aaac694803004a63c6f393d153c96d22521a6b9...3d86e43b075adeba2193ec5c22ac92f55afd82e6) is evidence of source changes, not proof of a particular model-facing output. Local `codex --version` reported `0.167.1`, not the pinned 0.172.0; no session was started.
