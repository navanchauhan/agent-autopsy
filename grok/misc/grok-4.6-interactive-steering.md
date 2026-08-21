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
