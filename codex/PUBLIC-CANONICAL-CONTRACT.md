# Canonical capture and publication contract

The surface registry binds each file listed below to a category, status, release and artifact digest. `CATALOG.md` is generated from these registries by `node .github/scripts/generate-catalog.cjs`; `node .github/scripts/validate-surfaces.cjs` verifies artifact coverage and digests. `validate-refresh.cjs` additionally checks the capture plan, summary, source inventory or model-request observations and publication scope. Evidence is transient driver input; a digest is not a substitute for the underlying evidence. Counts, version fields and artifact digests must correspond to actual captures.

The lists below are the files currently claimed by the canonical registries, not a claim that they are current at the newer publicly documented versions. New captures can require additional files.

## codex

Canonical metadata: `codex/VERSION`, `codex/SURFACES.json`; observed release `0.164.0`.
Source refresh requires pinned upstream revision, source-surface inventory, per-artifact source map, correct assembled prompt/tool/steering output and applicable model-mode metadata. Grouped catalog surfaces currently bind many files to one release; partial replacement would misattribute the group.

### `codex.prompt.agent.catalog`

Status `current`, method `direct-source`, captured release `0.164.0`:

- `codex/prompts/codex-auto-review.md`
- `codex/prompts/default.md`
- `codex/prompts/gpt-5-codex.md`
- `codex/prompts/gpt-5.1-codex-max.md`
- `codex/prompts/gpt-5.1.md`
- `codex/prompts/gpt-5.2-codex.md`
- `codex/prompts/gpt-5.2.md`
- `codex/prompts/gpt-5.4-mini.md`
- `codex/prompts/gpt-5.5.md`
- `codex/prompts/gpt-5.6-luna.md`
- `codex/prompts/gpt-5.6-sol.md`
- `codex/prompts/gpt-5.6-terra.md`
- `codex/prompts/gpt-6-astra.md`
- `codex/prompts/prompt-with-apply-patch-instructions.md`
- `codex/prompts/review.md`

### `codex.tool.catalog`

Status `current`, method `direct-source`, captured release `0.164.0`:

- `codex/tools/apply_patch.json`
- `codex/tools/clock.json`
- `codex/tools/create_goal.json`
- `codex/tools/exec_command.json`
- `codex/tools/get_context_remaining.json`
- `codex/tools/get_goal.json`
- `codex/tools/image_gen.json`
- `codex/tools/list_available_plugins_to_install.json`
- `codex/tools/list_mcp_resource_templates.json`
- `codex/tools/list_mcp_resources.json`
- `codex/tools/new_context_window.json`
- `codex/tools/read_mcp_resource.json`
- `codex/tools/request_permissions.json`
- `codex/tools/request_plugin_install.json`
- `codex/tools/request_user_input.json`
- `codex/tools/shell_command.json`
- `codex/tools/tool_search.json`
- `codex/tools/update_goal.json`
- `codex/tools/update_plan.json`
- `codex/tools/view_image.json`
- `codex/tools/wait_for_environment.json`
- `codex/tools/web_search.json`
- `codex/tools/web_search_indexed.json`
- `codex/tools/web_search_text_and_image.json`
- `codex/tools/write_stdin.json`

### `codex.steering.catalog`

Status `current`, method `direct-source`, captured release `0.164.0`:

- `codex/misc/agents-orchestrator.md`
- `codex/misc/apply-patch-tool-instructions.md`
- `codex/misc/apps-instructions.md`
- `codex/misc/collab-experimental-prompt.md`
- `codex/misc/compact-prompt.md`
- `codex/misc/compact-summary-prefix.md`
- `codex/misc/environments-instructions.md`
- `codex/misc/goal-budget-limit.md`
- `codex/misc/goal-continuation.md`
- `codex/misc/goal-objective-updated.md`
- `codex/misc/guardian-policy.md`
- `codex/misc/inter-agent-message.md`
- `codex/misc/multi-agent-mode-explicit-request-only.md`
- `codex/misc/multi-agent-mode-proactive.md`
- `codex/misc/permissions-approval-policy-never.md`
- `codex/misc/permissions-approval-policy-on-request-rule-request-permission.md`
- `codex/misc/permissions-approval-policy-on-request.md`
- `codex/misc/permissions-approval-policy-unless-trusted.md`
- `codex/misc/permissions-sandbox-mode-danger-full-access.md`
- `codex/misc/permissions-sandbox-mode-read-only.md`
- `codex/misc/permissions-sandbox-mode-workspace-write.md`
- `codex/misc/plugins-instructions.md`
- `codex/misc/realtime-backend-prompt.md`
- `codex/misc/realtime-delegation.md`
- `codex/misc/realtime-end.md`
- `codex/misc/realtime-start.md`
- `codex/misc/recommended-plugins.md`
- `codex/misc/review-exit-interrupted.xml`
- `codex/misc/review-exit-success.xml`

## claude-code

Canonical metadata: `claude-code/VERSION`, `claude-code/SURFACES.json`; observed release `2.1.270`.
Prompt and tool surfaces below are model-request captures. A newer release needs complete, release-matched request observations and evidence for each claimed mode/model and schema; public feature documentation or SDK definitions are not equivalent. No live request capture was authorized for this pass.

### `claude-code.prompt.agent.claude-fable-5-1.non-interactive`

Status `current`, method `model-request`, captured release `2.1.270`:

- `claude-code/prompts/claude-fable-5-1.md`

### `claude-code.prompt.agent.claude-haiku-4-5-20251001.non-interactive`

Status `current`, method `model-request`, captured release `2.1.270`:

- `claude-code/prompts/claude-haiku-4-5-20251001.md`

### `claude-code.prompt.agent.claude-opus-5.non-interactive`

Status `current`, method `model-request`, captured release `2.1.270`:

- `claude-code/prompts/claude-opus-5.md`

### `claude-code.prompt.agent.claude-sonnet-5.interactive`

Status `current`, method `model-request`, captured release `2.1.270`:

- `claude-code/prompts/claude-sonnet-5-interactive.md`

### `claude-code.prompt.agent.claude-sonnet-5.non-interactive`

Status `current`, method `model-request`, captured release `2.1.270`:

- `claude-code/prompts/claude-sonnet-5.md`

### `claude-code.prompt.special.session-title`

Status `current`, method `model-request`, captured release `2.1.270`:

- `claude-code/prompts/claude-haiku-4-5-20251001-session-title.md`

### `claude-code.steering.interactive`

Status `current`, method `model-request`, captured release `2.1.270`:

- `claude-code/misc/claude-sonnet-5-interactive-steering.md`

### `claude-code.steering.non-interactive`

Status `current`, method `model-request`, captured release `2.1.270`:

- `claude-code/misc/claude-fable-5-1-steering.md`
- `claude-code/misc/claude-haiku-4-5-20251001-steering.md`
- `claude-code/misc/claude-opus-5-steering.md`
- `claude-code/misc/claude-sonnet-5-steering.md`

### `claude-code.tool.catalog`

Status `current`, method `model-request`, captured release `2.1.270`:

- `claude-code/tools/Agent.json`
- `claude-code/tools/Artifact.json`
- `claude-code/tools/AskUserQuestion.json`
- `claude-code/tools/Bash.json`
- `claude-code/tools/CronCreate.json`
- `claude-code/tools/CronDelete.json`
- `claude-code/tools/CronList.json`
- `claude-code/tools/DeferredToolPlaceholder.json`
- `claude-code/tools/DesignSync.json`
- `claude-code/tools/Edit.json`
- `claude-code/tools/EndConversation.json`
- `claude-code/tools/EnterPlanMode.json`
- `claude-code/tools/EnterWorktree.json`
- `claude-code/tools/ExitPlanMode.json`
- `claude-code/tools/ExitWorktree.json`
- `claude-code/tools/ListAgents.json`
- `claude-code/tools/Monitor.json`
- `claude-code/tools/NotebookEdit.json`
- `claude-code/tools/PushNotification.json`
- `claude-code/tools/Read.json`
- `claude-code/tools/RemoteTrigger.json`
- `claude-code/tools/ReportFindings.json`
- `claude-code/tools/ScheduleWakeup.json`
- `claude-code/tools/SendFeedback.json`
- `claude-code/tools/SendMessage.json`
- `claude-code/tools/Skill.json`
- `claude-code/tools/TaskCreate.json`
- `claude-code/tools/TaskGet.json`
- `claude-code/tools/TaskList.json`
- `claude-code/tools/TaskOutput.json`
- `claude-code/tools/TaskStop.json`
- `claude-code/tools/TaskUpdate.json`
- `claude-code/tools/ToolSearch.json`
- `claude-code/tools/WebFetch.json`
- `claude-code/tools/WebSearch.json`
- `claude-code/tools/Workflow.json`
- `claude-code/tools/Write.json`

## antigravity

Canonical metadata: `antigravity/VERSION`, `antigravity/SURFACES.json`; observed release `1.4.6`.
Prompt and tool surfaces below are model-request captures. A newer release needs complete, release-matched request observations and evidence for each claimed mode/model and schema; public feature documentation or SDK definitions are not equivalent. No live request capture was authorized for this pass.

### `antigravity.prompt.agent.gemini-4-argon-medium.interactive`

Status `current`, method `model-request`, captured release `1.4.6`:

- `antigravity/prompts/gemini-4-argon-medium-interactive.md`

### `antigravity.prompt.agent.gemini-4-argon-medium.non-interactive`

Status `current`, method `model-request`, captured release `1.4.6`:

- `antigravity/prompts/gemini-4-argon-medium.md`

### `antigravity.tool.catalog`

Status `current`, method `model-request`, captured release `1.4.6`:

- `antigravity/tools/ask_question.json`
- `antigravity/tools/define_subagent.json`
- `antigravity/tools/invoke_subagent.json`
- `antigravity/tools/manage_subagents.json`
- `antigravity/tools/manage_task.json`
- `antigravity/tools/edit_file.json`
- `antigravity/tools/run_command.json`
- `antigravity/tools/schedule.json`
- `antigravity/tools/search_web.json`
- `antigravity/tools/send_message.json`
- `antigravity/tools/read_file.json`
- `antigravity/tools/write_file.json`
