<user_info>
OS Version: <harnessVariable>{{osVersion=macos}}</harnessVariable>
Shell: <harnessVariable>{{shell=/bin/zsh}}</harnessVariable>
Workspace Path: <harnessVariable>{{workspacePath=/Users/example/Developer/example-repo}}</harnessVariable>
Today's date: <harnessVariable>{{currentDate=2026-01-02}}</harnessVariable>
Note: Prefer using relative paths over absolute paths as tool call args when possible.
</user_info>

<git_status>
This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.
<harnessVariable>{{gitStatus=## main...origin/main
 M example.txt}}</harnessVariable>
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

<user_query>
<harnessVariable>{{userRequest=Reply exactly: GROK_INTERACTIVE_TRACE_OK}}</harnessVariable>
</user_query>
