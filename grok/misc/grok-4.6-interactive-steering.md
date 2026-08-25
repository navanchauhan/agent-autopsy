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

<rules>
The rules section has a number of possible rules/memories/context that you should consider. In each subsection, we provide instructions about what information the subsection contains and how you should consider/follow the contents of the subsection.


<user_rules description="These are rules set by the user that you should follow if appropriate.">
<user_rule>When implementing or fixing anything in a web application (UI, layout, styling, routing, client state, or rendered data), verify your work in the browser before declaring the task complete.

**Use this verification workflow:**
- Open the app with the available browser tools and exercise the changed feature end to end the way a real user would: click, type, submit, navigate.
- A single render screenshot of the changed screen is NOT verification. Confirm behavior, not just appearance.
- Check every page and route that shares the state, data, or components you touched. Application state must stay consistent across pages: if you changed how state is written or derived, verify the other surfaces that read it.
- Hunt for regressions. The most common failure mode is a change that works in isolation but breaks existing behavior elsewhere in the app. Navigate the surrounding flows and look for what broke.
- Verify the paths and edge states your change touches (empty states, error states, route and flag variants), not only the main path.
- When layout or styling changed, check both desktop and mobile viewports.
- If verification finds a problem, fix it and re-verify. Do not finish with unverified UI work.

If no browser tools are available, verify through the closest available substitute (tests, curl against the dev server, rendering scripts) and say what you could not verify.</user_rule>
</user_rules>
</rules>

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
