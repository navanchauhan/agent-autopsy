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
