# Claude Code documented tools

Source: [official tools reference](https://code.claude.com/docs/en/tools-reference.md), fetched 2026-11-24 UTC; SHA-256 `acfb2f5d6090825cd731cd0cc08b05359cd429ad2d7ae788036098d38f0e4356`. The mutable documentation is not version-pinned to the 2.1.331 release. Names and manual-mode permission column are transcribed from its table; they are not observed session registrations. Consult the source for restrictions, exceptions, and tool behavior. `TaskOutput` is explicitly marked removed there.

| Tool | Documented permission |
| --- | --- |
| `Agent` | No |
| `Artifact` | Yes |
| `AskUserQuestion` | No |
| `Bash` | Yes |
| `CronCreate` | No |
| `CronDelete` | No |
| `CronList` | No |
| `Edit` | Yes |
| `EndConversation` | No |
| `EnterPlanMode` | No |
| `EnterWorktree` | Some worktrees |
| `ExitPlanMode` | Yes |
| `ExitWorktree` | Yes on v2.1.327 or later, to remove a worktree when Claude Code can't check it or finds work at risk, such as unpushed commits or files that `git status` lists |
| `Glob` | No |
| `Grep` | No |
| `ListAgents` | No |
| `ListMcpResourcesTool` | No |
| `ListPlugins` | No |
| `ListSkills` | No |
| `LSP` | No |
| `Monitor` | Yes |
| `NotebookEdit` | Yes |
| `PowerShell` | Yes |
| `propose_skills` | No |
| `PushNotification` | No |
| `Read` | No |
| `ReadMcpResourceTool` | No |
| `RemoteTrigger` | No |
| `ReportFindings` | No |
| `ScheduleWakeup` | No |
| `SearchPlugins` | No |
| `SearchSkills` | No |
| `SendFeedback` | No |
| `SendMessage` | No |
| `SendUserFile` | No |
| `ShareOnboardingGuide` | Yes |
| `Skill` | Some skills |
| `SubagentHandback` | No |
| `SuggestPluginInstall` | No |
| `SuggestSkills` | No |
| `TaskCreate` | No |
| `TaskGet` | No |
| `TaskList` | No |
| `TaskOutput` | No |
| `TaskStop` | No |
| `TaskUpdate` | No |
| `TodoWrite` | No |
| `ToolSearch` | No |
| `WaitForMcpServers` | No |
| `WebFetch` | Yes |
| `WebSearch` | Yes |
| `Workflow` | Yes |
| `Write` | Yes |
