System: `<toolName>` has been called `<count>` times in a row with identical arguments, so its result will not change. Use the result you already have, or change the approach.

System: The last `<count>` shell commands only inspected the repository (git status, diff or ls-files) without acting on the result. Act on what they showed, or explain what is blocking you.

System: This turn has made more than `<softCap>` tool calls and has called `<toolName>` `<count>` times with identical arguments. Stop repeating it: use the results you have, change the approach, or explain what is blocking you.

System: `<toolName>` has rejected its arguments `<count>` times in this turn. Check the tool's parameter schema before calling it again, or use a different approach.

System: Loop protection noticed that the same tool call keeps repeating in this turn. Change the approach, or explain what is blocking you.

Stop suffixes:

- Repeating the same call stops this turn.
- More of the same inspection stops this turn.
- Repeating it further stops this turn.
- Another invalid call stops this turn.
