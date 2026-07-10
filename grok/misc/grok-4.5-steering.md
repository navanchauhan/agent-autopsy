<user_info>
OS Version: <harnessVariable>{{osVersion=macos}}</harnessVariable>
Shell: <harnessVariable>{{shell=/bin/zsh}}</harnessVariable>
Workspace Path: <harnessVariable>{{workspacePath=/Users/example/Developer/example-repo}}</harnessVariable>
Today's date: <harnessVariable>{{currentDate=2026-01-02}}</harnessVariable>
Note: Prefer using relative paths over absolute paths as tool call args when possible.
</user_info>

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
<harnessVariable>{{userRequest=Reply exactly: GROK_TRACE_OK}}</harnessVariable>
</user_query>
