Analyze this Qwen Code usage data and suggest improvements.

## QC FEATURES REFERENCE (pick from these for features_to_try):
1. **MCP Servers**: Connect Qwen to external tools, databases, and APIs via Model Context Protocol.
   - How to use: Run `qwen mcp add --transport http <server-name> <http-url>`
   - Good for: database queries, Slack integration, GitHub issue lookup, connecting to internal APIs
   - Example: "To connect to GitHub, run `qwen mcp add --header "Authorization: Bearer your_github_mcp_pat" --transport http github https://api.githubcopilot.com/mcp/` and set the AUTHORIZATION header with your PAT. Then you can ask Qwen to query issues, PRs, or repos."

2. **Custom Skills**: Reusable prompts you define as markdown files that run with a single /command.
   - How to use: Create `.qwen/skills/commit/SKILL.md` with instructions. Then type `/commit` to run it.
   - Good for: repetitive workflows - /commit, /review, /test, /deploy, /pr, or complex multi-step workflows
   - SKILL.md format:
    ```
    ---
    name: skill-name
    description: A description of what this skill does and when to use it.
    ---

    # Steps
    1. First, do X.
    2. Then do Y.
    3. Finally, verify Z.

    # Examples
    - Input: "fix lint errors in src/" → Output: runs eslint --fix, commits changes
    - Input: "review this PR" → Output: reads diff, posts inline comments

    # Edge Cases
    - If no files match, report "nothing to do" instead of failing.
    - If the user didn't specify a branch, default to the current branch.
    ```

3. **Headless Mode**: Run Qwen non-interactively from scripts and CI/CD.
   - How to use: `qwen -p "fix lint errors"`
   - Good for: CI/CD integration, batch code fixes, automated reviews

4. **Task Agents**: Qwen spawns focused sub-agents for complex exploration or parallel work.
   - How to use: Qwen auto-invokes when helpful, or ask "use an agent to explore X"
   - Good for: codebase exploration, understanding complex systems

Call respond_in_schema function with A VALID JSON OBJECT as argument:
{
  "Qwen_md_additions": [
    {"addition": "A specific line or block to add to QWEN.md based on workflow patterns. E.g., 'Always run tests after modifying auth-related files'", "why": "1 sentence explaining why this would help based on actual sessions", "prompt_scaffold": "Instructions for where to add this in QWEN.md. E.g., 'Add under ## Testing section'"}
  ],
  "features_to_try": [
    {"feature": "Feature name from QC FEATURES REFERENCE above", "one_liner": "What it does", "why_for_you": "Why this would help YOU based on your sessions", "example_code": "Actual command or config to copy"}
  ],
  "usage_patterns": [
    {"title": "Short title", "suggestion": "1-2 sentence summary", "detail": "3-4 sentences explaining how this applies to YOUR work", "copyable_prompt": "A specific prompt to copy and try"}
  ]
}

IMPORTANT for Qwen_md_additions: PRIORITIZE instructions that appear MULTIPLE TIMES in the user data. If user told Qwen the same thing in 2+ sessions (e.g., 'always run tests', 'use TypeScript'), that's a PRIME candidate - they shouldn't have to repeat themselves.

IMPORTANT for features_to_try: Pick 2-3 from the QC FEATURES REFERENCE above. Include 2-3 items for each category.
