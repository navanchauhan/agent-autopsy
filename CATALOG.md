# Agent Autopsy Catalog

This file is generated from each provider's `SURFACES.json`. Do not edit it directly.

Status meanings: `current` is captured at the observed release; `verified-unchanged` was checked at that release; `stale` is older; `frozen` has no current capture path; `gap` is known but absent; and `dynamic` is intentionally represented only as a typed input.

## ampcode

Observed release: `0.0.1783542413-gb55c7a`

| Surface | Category | Models | Modes | Status | Captured | Artifacts |
| --- | --- | --- | --- | --- | --- | --- |
| `ampcode.prompt.agent.catalog` | agent prompts | `server-selected` | `smart`, `deep`, `large`, `rush` | frozen | `0.0.1779927513-g17febb` | [deep.md](ampcode/prompts/deep.md), [large.md](ampcode/prompts/large.md), [rush.md](ampcode/prompts/rush.md), [smart.md](ampcode/prompts/smart.md) |
| `ampcode.tool.catalog` | tool schemas | `server-selected` | `smart`, `deep`, `large`, `rush` | current | `0.0.1783542413-gb55c7a` | 10 files ([manifest](ampcode/SURFACES.json)) |
| `ampcode.agent.definitions` | bundled agent prompts | `server-selected` | `finder`, `librarian`, `task` | gap | — | — |
| `ampcode.skill.definitions` | bundled skills and MCP prompts | `server-selected` | `skills and MCP` | gap | — | — |
| `ampcode.context.session` | dynamic context | `server-selected` | `all` | dynamic | — | — |
| `ampcode.assembly.model-mode` | assembly recipe | `server-selected` | `all` | gap | — | — |

## antigravity

Observed release: `1.3.3`

| Surface | Category | Models | Modes | Status | Captured | Artifacts |
| --- | --- | --- | --- | --- | --- | --- |
| `antigravity.prompt.agent.gemini-3-8-flash-high.interactive` | agent prompt | `gemini-3.8-flash-high` | `interactive` | current | `1.3.3` | [gemini-3.8-flash-high-interactive.md](antigravity/prompts/gemini-3.8-flash-high-interactive.md) |
| `antigravity.prompt.agent.gemini-3-8-flash-high.non-interactive` | agent prompt | `gemini-3.8-flash-high` | `non-interactive` | verified-unchanged | `1.3.3` | [gemini-3.8-flash-high.md](antigravity/prompts/gemini-3.8-flash-high.md) |
| `antigravity.tool.catalog` | tool schemas | `gemini-3.8-flash-high` | `interactive`, `non-interactive` | current | `1.3.3` | 13 files ([manifest](antigravity/SURFACES.json)) |

## claude-code

Observed release: `2.1.296`

| Surface | Category | Models | Modes | Status | Captured | Artifacts |
| --- | --- | --- | --- | --- | --- | --- |
| `claude-code.prompt.agent.claude-fable-5-1.non-interactive` | agent prompt | `claude-fable-5-1` | `non-interactive` | current | `2.1.296` | [claude-fable-5-1.md](claude-code/prompts/claude-fable-5-1.md) |
| `claude-code.prompt.agent.claude-haiku-5-5.non-interactive` | agent prompt | `claude-haiku-5-5` | `non-interactive` | current | `2.1.296` | [claude-haiku-5-5.md](claude-code/prompts/claude-haiku-5-5.md) |
| `claude-code.prompt.agent.claude-opus-5-5.non-interactive` | agent prompt | `claude-opus-5-5` | `non-interactive` | current | `2.1.296` | [claude-opus-5-5.md](claude-code/prompts/claude-opus-5-5.md) |
| `claude-code.prompt.agent.claude-sonnet-5-5.non-interactive` | agent prompt | `claude-sonnet-5-5` | `non-interactive` | current | `2.1.296` | [claude-sonnet-5-5.md](claude-code/prompts/claude-sonnet-5-5.md) |
| `claude-code.prompt.agent.claude-sonnet-5-5.interactive` | agent prompt | `claude-sonnet-5-5` | `interactive` | current | `2.1.296` | [claude-sonnet-5-5-interactive.md](claude-code/prompts/claude-sonnet-5-5-interactive.md) |
| `claude-code.prompt.special.prompt-suggestion` | prompt suggestion prompt | `claude-sonnet-5-5` | `interactive` | current | `2.1.296` | [prompt-suggestion.md](claude-code/misc/prompt-suggestion.md) |
| `claude-code.prompt.special.session-title` | session title prompt | `claude-haiku-5-5` | `session-title` | current | `2.1.296` | [claude-haiku-5-5-session-title-message.md](claude-code/misc/claude-haiku-5-5-session-title-message.md), [claude-haiku-5-5-session-title.md](claude-code/prompts/claude-haiku-5-5-session-title.md) |
| `claude-code.steering.interactive` | steering messages | `claude-sonnet-5-5` | `interactive` | current | `2.1.296` | [claude-sonnet-5-5-interactive-steering.md](claude-code/misc/claude-sonnet-5-5-interactive-steering.md) |
| `claude-code.steering.non-interactive` | steering messages | `claude-fable-5-1`, `claude-haiku-5-5`, `claude-opus-5-5`, `claude-sonnet-5-5` | `non-interactive` | current | `2.1.296` | [claude-fable-5-1-steering.md](claude-code/misc/claude-fable-5-1-steering.md), [claude-haiku-5-5-steering.md](claude-code/misc/claude-haiku-5-5-steering.md), [claude-opus-5-5-steering.md](claude-code/misc/claude-opus-5-5-steering.md), [claude-sonnet-5-5-steering.md](claude-code/misc/claude-sonnet-5-5-steering.md) |
| `claude-code.tool.catalog` | tool schemas | `claude-fable-5-1`, `claude-haiku-5-5`, `claude-opus-5-5`, `claude-sonnet-5-5` | `interactive`, `non-interactive` | current | `2.1.296` | 34 files ([manifest](claude-code/SURFACES.json)) |
| `claude-code.tool.legacy` | tool schemas | `claude-haiku-4-5-20251001`, `claude-sonnet-5` | `interactive`, `non-interactive` | stale | `2.1.270` | 5 files ([manifest](claude-code/SURFACES.json)) |
| `claude-code.prompt.agent.claude-haiku-4-5-20251001.non-interactive` | agent prompt | `claude-haiku-4-5-20251001` | `non-interactive` | stale | `2.1.270` | [claude-haiku-4-5-20251001.md](claude-code/prompts/claude-haiku-4-5-20251001.md) |
| `claude-code.prompt.agent.claude-opus-5.non-interactive` | agent prompt | `claude-opus-5` | `non-interactive` | stale | `2.1.270` | [claude-opus-5.md](claude-code/prompts/claude-opus-5.md) |
| `claude-code.prompt.agent.claude-sonnet-5.non-interactive` | agent prompt | `claude-sonnet-5` | `non-interactive` | stale | `2.1.270` | [claude-sonnet-5.md](claude-code/prompts/claude-sonnet-5.md) |
| `claude-code.prompt.agent.claude-sonnet-5.interactive` | agent prompt | `claude-sonnet-5` | `interactive` | stale | `2.1.270` | [claude-sonnet-5-interactive.md](claude-code/prompts/claude-sonnet-5-interactive.md) |
| `claude-code.steering.legacy` | steering messages | `claude-haiku-4-5-20251001`, `claude-opus-5`, `claude-sonnet-5` | `interactive`, `non-interactive` | stale | `2.1.270` | [claude-haiku-4-5-20251001-steering.md](claude-code/misc/claude-haiku-4-5-20251001-steering.md), [claude-opus-5-steering.md](claude-code/misc/claude-opus-5-steering.md), [claude-sonnet-5-interactive-steering.md](claude-code/misc/claude-sonnet-5-interactive-steering.md), [claude-sonnet-5-steering.md](claude-code/misc/claude-sonnet-5-steering.md) |

## codex

Observed release: `0.162.1`

| Surface | Category | Models | Modes | Status | Captured | Artifacts |
| --- | --- | --- | --- | --- | --- | --- |
| `codex.prompt.agent.catalog` | agent prompts | `gpt-6-astra`, `gpt-5`, `gpt-5.1`, `gpt-5.2`, `gpt-5.5`, `gpt-5.6` | `default`, `review` | current | `0.162.1` | 15 files ([manifest](codex/SURFACES.json)) |
| `codex.tool.catalog` | tool schemas | `all` | `configured` | current | `0.162.1` | 25 files ([manifest](codex/SURFACES.json)) |
| `codex.steering.catalog` | runtime messages | `all` | `configured`, `multi-agent`, `realtime`, `review` | current | `0.162.1` | 29 files ([manifest](codex/SURFACES.json)) |
| `codex.assembly.model-mode` | assembly recipe | `all` | `all` | gap | `0.159.2` | — |
| `codex.context.session` | dynamic context | `all` | `all` | dynamic | `0.159.2` | — |
| `codex.tool.code-mode-listing` | dynamic tool catalog | `gpt-5.6` | `code-mode-only` | dynamic | `0.159.2` | — |
| `codex.policy.external-overrides` | external policy inputs | `all` | `managed`, `custom`, `realtime` | dynamic | `0.159.2` | — |

## grok

Observed release: `1.0.52`

| Surface | Category | Models | Modes | Status | Captured | Artifacts |
| --- | --- | --- | --- | --- | --- | --- |
| `grok.prompt.agent.grok-4-6.non-interactive` | agent prompt | `grok-4.6` | `non-interactive` | current | `1.0.52` | [grok-4.6.md](grok/prompts/grok-4.6.md) |
| `grok.prompt.special.session-title` | session title prompt | `grok-4.6` | `session-title` | current | `1.0.52` | [grok-session-title.md](grok/prompts/grok-session-title.md) |
| `grok.steering.catalog` | steering messages | `grok-4.6`, `grok-4.7` | `interactive`, `non-interactive` | current | `1.0.52` | [grok-4.6-steering.md](grok/misc/grok-4.6-steering.md), [grok-4.7-auxiliary-user-templates.md](grok/misc/grok-4.7-auxiliary-user-templates.md), [grok-4.7-interactive-steering.md](grok/misc/grok-4.7-interactive-steering.md) |
| `grok.tool.catalog` | tool schemas | `grok-4.6`, `grok-4.7` | `interactive`, `non-interactive`, `session-title` | current | `1.0.52` | 29 files ([manifest](grok/SURFACES.json)) |
| `grok.prompt.agent.grok-4-7.interactive` | agent prompt | `grok-4.7` | `interactive` | current | `1.0.52` | [grok-4.7-interactive.md](grok/prompts/grok-4.7-interactive.md) |
| `grok.prompt.special.memory-capture` | memory capture prompt | `grok-4.7` | `interactive` | current | `1.0.52` | [grok-memory-capture.md](grok/prompts/grok-memory-capture.md), [grok-memory-capture-output-schema.json](grok/misc/grok-memory-capture-output-schema.json) |
| `grok.prompt.special.prompt-suggestion` | prompt suggestion prompt | `grok-4.7` | `interactive` | current | `1.0.52` | [grok-prompt-suggestion.md](grok/prompts/grok-prompt-suggestion.md) |
| `grok.prompt.special.turn-summary` | turn summary prompt | `grok-4.7` | `interactive` | current | `1.0.52` | [grok-turn-summary.md](grok/prompts/grok-turn-summary.md) |
| `grok.source.snapshot` | source prompt and tool construction | `grok-4.6`, `grok-4.7` | `interactive`, `non-interactive`, `session-title` | gap | — | — |

## qwen-code

Observed release: `0.25.1`

| Surface | Category | Models | Modes | Status | Captured | Artifacts |
| --- | --- | --- | --- | --- | --- | --- |
| `qwen-code.prompt.agent.catalog` | agent prompts | `all` | `interactive`, `headless`, `acp` | current | `0.25.1` | [core-acp-qwen3-coder-plus.md](qwen-code/prompts/core-acp-qwen3-coder-plus.md), [core-headless-qwen3-coder-plus.md](qwen-code/prompts/core-headless-qwen3-coder-plus.md), [core-interactive-qwen3-coder-plus.md](qwen-code/prompts/core-interactive-qwen3-coder-plus.md) |
| `qwen-code.tool.catalog` | tool schemas | `all` | `configured`, `deferred` | current | `0.25.1` | 53 files ([manifest](qwen-code/SURFACES.json)) |
| `qwen-code.steering.catalog` | runtime messages | `all` | `configured`, `planning`, `compression`, `insights` | current | `0.25.1` | 16 files ([manifest](qwen-code/SURFACES.json)) |
| `qwen-code.context.session` | dynamic context | `all` | `all` | dynamic | — | — |
