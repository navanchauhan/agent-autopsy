# Manual public inventory coverage

Compared with Agent Autopsy release [`2026.10.23`](https://github.com/navanchauhan/agent-autopsy/releases/tag/2026.10.23), commit `568fbf654b4d4d4c827a1a309e9066a898dcd476`. Checks were made on 2026-11-24 UTC. Earlier capture registries and artifacts remain historical, not revalidated.

| Provider | Archived version | Public release checked | Coverage and limits |
| --- | --- | --- | --- |
| Codex | 0.164.0, source `6aaac694803004a63c6f393d153c96d22521a6b9` | 0.172.0, source `3d86e43b075adeba2193ec5c22ac92f55afd82e6` | [Source index](PUBLIC-SOURCE-INDEX.md) enumerates prompt/template and tool-related path candidates and declaration matches. It is inclusive and mechanical, not a complete runtime registration or assembled prompt. |
| Claude Code | 2.1.270 traced capture | 2.1.331 release and version-only local observation | [Documented tools](../claude-code/PUBLIC-TOOLS.md), SDK inputs, permissions and instruction customization; exact newer prompt and wire schemas unavailable. |
| Antigravity CLI | 1.4.6 traced capture | 1.5.16 Linux manifest; local version 1.5.14 | [Documented SDK tools and CLI permissions](../antigravity/PUBLIC-INVENTORY.md), model selector and rules; exact newer CLI prompt and wire schemas unavailable. |

Codex source comparison shows the Guardian policy template changed its post-denial approval wording. The `get_context_remaining` tool builder now applies optional catalog-supplied tool messages; its source default still defines an empty input object. These are [source changes](https://github.com/openai/codex/compare/6aaac694803004a63c6f393d153c96d22521a6b9...3d86e43b075adeba2193ec5c22ac92f55afd82e6), not observations of a running session. Neither Claude nor Antigravity public documentation establishes an exact prompt or wire-schema delta against the archived captures.

Google [announced Neon on November 18, 2026](https://antigravity.google/blog/gemini-4-neon-in-google-antigravity). Its [model documentation](https://antigravity.google/docs/models) names Gemini 4 Neon and Hydrogen, describes Orchestrator (Neon) as a planner/executor pairing, and gives a CLI `gemini-4-neon-xhigh` example. The model names, selector and CLI example are distinct; availability is surface- and plan-dependent. Hydrogen's launch date was not established here. These names were not observed in a session, and no prompt or tool artifact is attributed to them.
