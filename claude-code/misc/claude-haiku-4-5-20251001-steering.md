<harnessVariable>
<system-reminder>
The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:
{{#each deferredTools}}
{{name}}
{{/each}}

Example:
Read
Edit
</system-reminder>
</harnessVariable>

<system-reminder>
Available agent types for the Agent tool:
- claude: Catch-all for any task that doesn't fit a more specific agent. FleetView's default when no agent name is typed. (Tools: *)
- Explore: Fast read-only search agent for locating code. Use it to find files by pattern (eg. "src/components/**/*.tsx"), grep for symbols or keywords (eg. "API endpoints"), or answer "where is X defined / which files reference Y." Do NOT use it for code review, design-doc auditing, cross-file consistency checks, or open-ended analysis — it reads excerpts rather than whole files and will miss content past its read window. When calling, specify search breadth: "quick" for a single targeted lookup, "medium" for moderate exploration, or "very thorough" to search across multiple locations and naming conventions. (Tools: All tools except Agent, Artifact, ArtifactComments, ArtifactData, ArtifactCheck, ExitPlanMode, Edit, Write, NotebookEdit)
- general-purpose: General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. (Tools: *)
- Plan: Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs. (Tools: All tools except Agent, Artifact, ArtifactComments, ArtifactData, ArtifactCheck, ExitPlanMode, Edit, Write, NotebookEdit)
- statusline-setup: Use this agent to configure the user's Claude Code status line setting. (Tools: Read, Edit)

When you launch multiple agents for independent work, send them in a single message with multiple tool uses so they run concurrently.
</system-reminder>

<harnessVariable>
<system-reminder>
The following skills are available for use with the Skill tool:

{{#each availableSkills}}
- {{name}}: {{description}}
{{/each}}

Example:
- example-skill: Example user-installed skill description.
</system-reminder>
</harnessVariable>

<system-reminder>
<total_tokens>15000000 tokens left</total_tokens>
</system-reminder>


<system-reminder>
As you answer the user's questions, you can use the following context:
# gitStatus
This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.

Current branch: <harnessVariable>{{currentBranch=feature/example-branch}}</harnessVariable>

Main branch (you will usually use this for PRs): <harnessVariable>{{mainBranch=default-branch}}</harnessVariable>

Status:
<harnessVariable>
{{#each gitStatusEntries}}
{{status}} {{path}}
{{/each}}

Example:
M src/example.ts
?? docs/example.md
</harnessVariable>

Recent commits:
<harnessVariable>
{{#each recentCommits}}
{{shortSha}} {{subject}}
{{/each}}

Example:
abc1234 Add example feature
def5678 Initial commit
</harnessVariable>
