<harnessVariable>
<system-reminder>
The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:
CronCreate
CronDelete
CronList
EnterPlanMode
EnterWorktree
ExitPlanMode
ExitWorktree
LSP
Monitor
NotebookEdit
PushNotification
RemoteTrigger
TaskCreate
TaskGet
TaskList
TaskOutput
TaskStop
TaskUpdate
WebFetch
WebSearch
</system-reminder>
</harnessVariable>

<harnessVariable>
<system-reminder>
The following skills are available for use with the Skill tool:

- image-taste-frontend: Elite frontend image-direction skill for generating premium, artistic, implementation-friendly website design references. Uses combinatorial variation to avoid repetitive AI aesthetics, enforces cinematic hero minimalism, strong hierarchy, generous spacing, image-led composition, and anti-slop visual discipline. For visual frontend tasks, this skill must first generate the design image(s) itself, deeply analyze them, then implement the frontend to match them as closely as possible.
- imagegen-frontend-mobile: Elite mobile app image-generation skill for creating premium, app-native screen concepts and flows. Designed for iOS, Android, and cross-platform mobile products. Prioritizes clean hierarchy, comfortably readable text, strong multi-screen consistency, controlled color palettes, non-generic creative direction, textured surfaces, image-led composition, tasteful custom iconography, and clean phone mockup framing. By default, screens should be shown inside a subtle premium iPhone or similar phone mockup with a visible frame, while the main focus stays on the app content itself. This skill generates images only. It does not write code.
- swiftui-pro: Comprehensively reviews SwiftUI code for best practices on modern APIs, maintainability, and performance. Use when reading, writing, or reviewing SwiftUI projects.
- swiftdata-pro: Writes, reviews, and improves SwiftData code using modern APIs and best practices. Use when reading, writing, or reviewing projects that use SwiftData.
- swift-testing-pro: Writes, reviews, and improves Swift Testing code using modern APIs and best practices. Use when reading, writing, or reviewing projects that use Swift Testing.
- swift-concurrency-pro: Reviews Swift code for concurrency correctness, modern API usage, and common async/await pitfalls. Use when reading, writing, or reviewing Swift concurrency code.
- swiftui-expert-skill: Write, review, or improve SwiftUI code following best practices for state management, view composition, performance, macOS-specific APIs, and iOS 26+ Liquid Glass adoption. Use when building new SwiftUI features, refactoring existing views, reviewing code quality, or adopting modern SwiftUI patterns. Also triggers whenever an Xcode Instruments `.trace` file is referenced (to analyse it) or the user asks to **record** a new trace — attach to a running app, launch one fresh, or capture a manually-stopped session with the bundled `record_trace.py`. A target SwiftUI source file is optional; if provided it grounds recommendations in specific lines, but a trace alone is enough to diagnose hangs, hitches, CPU hotspots, and high-severity SwiftUI updates.
- agent-slack: Slack automation CLI for AI agents. Use when:
- Reading a Slack message or thread (given a URL or channel+ts)
- Browsing recent channel messages / channel history
- Downloading Slack attachments (snippets, images, files) to local paths
- Searching Slack messages or files
- Sending, editing, or deleting a message; adding/removing reactions
- Listing channels/conversations; creating channels and inviting users
- Fetching a Slack canvas as markdown
- Looking up Slack users
- Marking channels/DMs as read
- Opening DM or group DM channels
- Discovering and running Slack workflows
- Managing saved-for-later messages (Later tab)
- Viewing all unread messages (inbox/unreads view)
Triggers: "slack message", "slack thread", "slack URL", "slack link", "read slack", "reply on slack", "search slack", "channel history", "recent messages", "channel messages", "latest messages", "mark as read", "mark read", "slack later", "saved for later", "save for later", "slack unreads", "slack inbox", "unread slack"
- update-config: Use this skill to configure the Claude Code harness via settings.json. Automated behaviors ("from now on when X", "each time X", "whenever X", "before/after X") require hooks configured in settings.json - the harness executes these, not Claude, so memory/preferences cannot fulfill them. Also use for: permissions ("allow X", "add permission", "move permission to"), env vars ("set X=Y"), hook troubleshooting, or any changes to settings.json/settings.local.json files. Examples: "allow npm commands", "add bq permission to global settings", "move permission to user settings", "set DEBUG=true", "when claude stops show X". For simple settings like theme/model, suggest the /config command.
- keybindings-help: Use when the user wants to customize keyboard shortcuts, rebind keys, add chord bindings, or modify ~/.claude/keybindings.json. Examples: "rebind ctrl+s", "add a chord shortcut", "change the submit key", "customize keybindings".
- verify: Verify that a code change actually does what it's supposed to by running the app and observing behavior. Use when asked to verify a PR, confirm a fix works, test a change manually, check that a feature works, or validate local changes before pushing.
- code-review: Review the current diff for correctness bugs at the given effort level (low/medium: fewer, high-confidence findings; high→max: broader coverage, may include uncertain findings). Pass --comment to post findings as inline PR comments.
- fewer-permission-prompts: Scan your transcripts for common read-only Bash and MCP tool calls, then add a prioritized allowlist to project .claude/settings.json to reduce permission prompts.
- loop: Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo). Omit the interval to let the model self-pace. - When the user wants to set up a recurring task, poll for status, or run something repeatedly on an interval (e.g. "check the deploy every 5 minutes", "keep running /babysit-prs"). Do NOT invoke for one-off tasks.
- schedule: Create, update, list, or run scheduled remote agents (routines) that execute on a cron schedule. - When the user wants to schedule a recurring remote agent, set up automated tasks, create a cron job for Claude Code, or manage their scheduled agents/routines. Also use when the user wants a one-time scheduled run ("run this once at 3pm", "remind me to check X tomorrow").
- claude-api: Build, debug, and optimize Claude API / Anthropic SDK apps. Apps built with this skill should include prompt caching. Also handles migrating existing Claude API code between Claude model versions (4.5 → 4.6, 4.6 → 4.7, retired-model replacements).
TRIGGER when: code imports `anthropic`/`@anthropic-ai/sdk`; user asks for the Claude API, Anthropic SDK, or Managed Agents; user adds/modifies/tunes a Claude feature (caching, thinking, compaction, tool use, batch, files, citations, memory) or model (Opus/Sonnet/Haiku) in a file; questions about prompt caching / cache hit rate in an Anthropic SDK project.
SKIP: file imports `openai`/other-provider SDK, filename like `*-openai.py`/`*-generic.py`, provider-neutral code, general programming/ML.
- run: Launch and drive this project's app to see a change working. Use when asked to run, start, or screenshot the app, or to confirm a change works in the real app (not just tests). First looks for a project skill that already covers launching the app; otherwise falls back to built-in patterns per project type (CLI, server, TUI, Electron, browser-driven, library).
- init: Initialize a new CLAUDE.md file with codebase documentation
- review: Review a pull request
- security-review: Complete a security review of the pending changes on the current branch
</system-reminder>
</harnessVariable>


<system-reminder>
As you answer the user's questions, you can use the following context:
# userEmail
The user's email address is <harnessVariable>user@example.com</harnessVariable>.
# currentDate
Today's date is <harnessVariable>2026-05-27</harnessVariable>.

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>



<harnessVariable>Reply exactly: CLAUDE_INTERACTIVE_TRACE_OK</harnessVariable>
