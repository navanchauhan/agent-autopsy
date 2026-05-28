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
As you answer the user's questions, you can use the following context:
# userEmail
The user's email address is <harnessVariable>{{userEmail=user@example.com}}</harnessVariable>.
# currentDate
Today's date is <harnessVariable>{{currentDate=2026-01-02}}</harnessVariable>.

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>



<harnessVariable>{{userRequest=Reply exactly: CLAUDE_INTERACTIVE_TRACE_OK}}</harnessVariable>
