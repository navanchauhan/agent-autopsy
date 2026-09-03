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

Observed release: `1.1.25`

| Surface | Category | Models | Modes | Status | Captured | Artifacts |
| --- | --- | --- | --- | --- | --- | --- |
| `antigravity.prompt.agent.gemini-3-8-flash-high.interactive` | agent prompt | `gemini-3.8-flash-high` | `interactive` | current | `1.1.25` | [gemini-3.8-flash-high-interactive.md](antigravity/prompts/gemini-3.8-flash-high-interactive.md) |
| `antigravity.prompt.agent.gemini-3-8-flash-high.non-interactive` | agent prompt | `gemini-3.8-flash-high` | `non-interactive` | current | `1.1.25` | [gemini-3.8-flash-high.md](antigravity/prompts/gemini-3.8-flash-high.md) |
| `antigravity.tool.catalog` | tool schemas | `gemini-3.8-flash-high` | `interactive`, `non-interactive` | current | `1.1.25` | 17 files ([manifest](antigravity/SURFACES.json)) |

## claude-code

Observed release: `2.1.259`

| Surface | Category | Models | Modes | Status | Captured | Artifacts |
| --- | --- | --- | --- | --- | --- | --- |
| `claude-code.prompt.agent.claude-fable-5-1.non-interactive` | agent prompt | `claude-fable-5-1` | `non-interactive` | current | `2.1.259` | [claude-fable-5-1.md](claude-code/prompts/claude-fable-5-1.md) |
| `claude-code.prompt.agent.claude-haiku-4-5-20251001.non-interactive` | agent prompt | `claude-haiku-4-5-20251001` | `non-interactive` | current | `2.1.259` | [claude-haiku-4-5-20251001.md](claude-code/prompts/claude-haiku-4-5-20251001.md) |
| `claude-code.prompt.agent.claude-opus-5.non-interactive` | agent prompt | `claude-opus-5` | `non-interactive` | current | `2.1.259` | [claude-opus-5.md](claude-code/prompts/claude-opus-5.md) |
| `claude-code.prompt.agent.claude-sonnet-5.interactive` | agent prompt | `claude-sonnet-5` | `interactive` | current | `2.1.259` | [claude-sonnet-5-interactive.md](claude-code/prompts/claude-sonnet-5-interactive.md) |
| `claude-code.prompt.agent.claude-sonnet-5.non-interactive` | agent prompt | `claude-sonnet-5` | `non-interactive` | current | `2.1.259` | [claude-sonnet-5.md](claude-code/prompts/claude-sonnet-5.md) |
| `claude-code.prompt.special.session-title` | session title prompt | `claude-haiku-4-5-20251001` | `session-title` | current | `2.1.259` | [claude-haiku-4-5-20251001-session-title.md](claude-code/prompts/claude-haiku-4-5-20251001-session-title.md) |
| `claude-code.steering.interactive` | steering messages | `claude-sonnet-5` | `interactive` | current | `2.1.259` | [claude-sonnet-5-interactive-steering.md](claude-code/misc/claude-sonnet-5-interactive-steering.md) |
| `claude-code.steering.non-interactive` | steering messages | `claude-fable-5-1`, `claude-haiku-4-5-20251001`, `claude-opus-5`, `claude-sonnet-5` | `non-interactive` | current | `2.1.259` | [claude-fable-5-1-steering.md](claude-code/misc/claude-fable-5-1-steering.md), [claude-haiku-4-5-20251001-steering.md](claude-code/misc/claude-haiku-4-5-20251001-steering.md), [claude-opus-5-steering.md](claude-code/misc/claude-opus-5-steering.md), [claude-sonnet-5-steering.md](claude-code/misc/claude-sonnet-5-steering.md) |
| `claude-code.tool.catalog` | tool schemas | `claude-fable-5-1`, `claude-haiku-4-5-20251001`, `claude-opus-5`, `claude-sonnet-5` | `interactive`, `non-interactive` | current | `2.1.259` | 37 files ([manifest](claude-code/SURFACES.json)) |

## codex

Observed release: `0.153.0`

| Surface | Category | Models | Modes | Status | Captured | Artifacts |
| --- | --- | --- | --- | --- | --- | --- |
| `codex.prompt.agent.catalog` | agent prompts | `gpt-5`, `gpt-5.1`, `gpt-5.2`, `gpt-5.4`, `gpt-5.5`, `gpt-5.6` | `default`, `review` | current | `0.153.0` | 15 files ([manifest](codex/SURFACES.json)) |
| `codex.tool.catalog` | tool schemas | `all` | `configured` | current | `0.153.0` | 25 files ([manifest](codex/SURFACES.json)) |
| `codex.steering.catalog` | runtime messages | `all` | `configured`, `multi-agent`, `realtime`, `review` | current | `0.153.0` | 29 files ([manifest](codex/SURFACES.json)) |
| `codex.assembly.model-mode` | assembly recipe | `all` | `all` | gap | — | — |
| `codex.context.session` | dynamic context | `all` | `all` | dynamic | — | — |
| `codex.tool.code-mode-listing` | dynamic tool catalog | `gpt-5.6` | `code-mode-only` | dynamic | — | — |
| `codex.policy.external-overrides` | external policy inputs | `all` | `managed`, `custom`, `realtime` | dynamic | — | — |

## grok

Observed release: `1.0.13`

| Surface | Category | Models | Modes | Status | Captured | Artifacts |
| --- | --- | --- | --- | --- | --- | --- |
| `grok.prompt.agent.grok-4-6.interactive` | agent prompt | `grok-4.6` | `interactive` | current | `1.0.13` | [grok-4.6-interactive.md](grok/prompts/grok-4.6-interactive.md) |
| `grok.prompt.agent.grok-4-6.non-interactive` | agent prompt | `grok-4.6` | `non-interactive` | current | `1.0.13` | [grok-4.6.md](grok/prompts/grok-4.6.md) |
| `grok.prompt.special.session-title` | session title prompt | `grok-4.6` | `session-title` | current | `1.0.13` | [grok-session-title.md](grok/prompts/grok-session-title.md) |
| `grok.steering.catalog` | steering messages | `grok-4.6` | `interactive`, `non-interactive` | current | `1.0.13` | [grok-4.6-interactive-steering.md](grok/misc/grok-4.6-interactive-steering.md), [grok-4.6-steering.md](grok/misc/grok-4.6-steering.md) |
| `grok.tool.catalog` | tool schemas | `grok-4.6` | `interactive`, `non-interactive`, `session-title` | current | `1.0.13` | 28 files ([manifest](grok/SURFACES.json)) |
| `grok.agent.definitions` | bundled agent prompts | `grok-4.6` | `subagent invocation` | gap | — | — |
| `grok.skill.definitions` | bundled skills and workflows | `grok-4.6` | `skill and workflow invocation` | gap | — | — |
| `grok.event.catalog` | event prompts | `grok-4.6` | `plan`, `scheduler`, `workflow`, `monitor`, `completion` | gap | — | — |
| `grok.mcp.instructions` | MCP and command prompts | `grok-4.6` | `MCP enabled`, `command invocation` | gap | — | — |
| `grok.context.session` | dynamic context | `grok-4.6` | `all` | dynamic | — | — |
| `grok.assembly.model-mode` | assembly recipe | `grok-4.6` | `all` | gap | — | — |

## qwen-code

Observed release: `0.22.3`

| Surface | Category | Models | Modes | Status | Captured | Artifacts |
| --- | --- | --- | --- | --- | --- | --- |
| `qwen-code.prompt.agent.catalog` | agent prompts | `all` | `interactive`, `headless`, `acp` | current | `0.22.3` | [core-acp-qwen3-coder-plus.md](qwen-code/prompts/core-acp-qwen3-coder-plus.md), [core-headless-qwen3-coder-plus.md](qwen-code/prompts/core-headless-qwen3-coder-plus.md), [core-interactive-qwen3-coder-plus.md](qwen-code/prompts/core-interactive-qwen3-coder-plus.md) |
| `qwen-code.tool.catalog` | tool schemas | `all` | `configured`, `deferred` | current | `0.22.3` | 46 files ([manifest](qwen-code/SURFACES.json)) |
| `qwen-code.steering.catalog` | runtime messages | `all` | `configured`, `planning`, `compression`, `insights` | current | `0.22.3` | 14 files ([manifest](qwen-code/SURFACES.json)) |
| `qwen-code.context.session` | dynamic context | `all` | `all` | dynamic | — | — |
