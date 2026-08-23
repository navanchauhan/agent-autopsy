<user_info>
OS Version: linux
Shell: /bin/bash
Workspace Path: <harnessVariable>{{workspacePath=/Users/example/Developer/example-repo}}</harnessVariable>
Today's date: <harnessVariable>{{currentDate=2026-01-02}}</harnessVariable>
Note: Prefer using relative paths over absolute paths as tool call args when possible.
</user_info>

<git_status>
This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.
## master...origin/master
</git_status>


---

<system-reminder>
The following skills are available for use:

{{#each availableSkills}}
- {{name}}: {{description}}
  Absolute path: {{path}}
{{/each}}

Example:
- example-skill: Example user-installed skill description.
  Absolute path: /Users/example/.grok/skills/example-skill/SKILL.md
</system-reminder>

---

<system-reminder>
MCP server connected:
- tasks (9 tools)

To use MCP tools, you MUST call `search_tool` first to retrieve the tool's input schema before calling `use_tool`. NEVER guess parameter names — always use the exact schema returned by `search_tool`.
</system-reminder>

---

<user_query>
<harnessVariable>{{userRequest=Reply exactly: GROK_INTERACTIVE_TRACE_OK}}</harnessVariable>
</user_query>

---



---

GROK_INTERACTIVE_TRACE_OK

---

<system-reminder>Write an ultra-short dashboard line that captures the AGENT'S REPLY for the last turn only — everything after the user message beginning: "user_query Reply exactly: GROK_INTERACTIVE_TRACE_OK /user_query". Focus on what the assistant concluded, answered, recommended, or delivered — not a meta description of the turn (avoid "Explained…", "Answered…", "Greeted…", "Reviewed…"). User-role messages wrapped in reminder tags like this one are injected context, not the user.

Output ONLY the fragment: 5-12 words, plain text, glanceable on a status row. Prefer the payload: answer, finding, change, or decision needed. Do NOT call any tools — respond with plain text only.

Synthetic examples (style only — adapt to THIS turn, do not copy):
`queue_worker` shutdown race fixed; suite green
Payment retries: exp backoff in `billing/retry.rs`, 5× on 429
Retry backoff wired into `billing/retry.rs`; tests pending
Need decision: keep or drop `sqlx` cache before refactor
Black — matches the terminal aesthetic

Bad (never):
- Lead with Explained / Answered / Greeted / Reviewed / Confirmed / Flagged / Summarized
- Labels, quotes, bullets, markdown, code fences, multi-sentence dumps
- Filler like "no code changes" or "awaiting task" unless that is the whole point
- Summarize earlier turns or the whole session
- Call tools or invent content not in the agent's reply</system-reminder>
