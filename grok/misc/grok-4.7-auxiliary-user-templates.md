# Memory capture (`prompts/grok-memory-capture.md`)

session_id=<harnessVariable>{{sessionId=00000000-0000-0000-0000-000000000000}}</harnessVariable>
from_turn=<harnessVariable>{{fromTurn=1}}</harnessVariable>
through_turn=<harnessVariable>{{throughTurn=1}}</harnessVariable>
durable_conversation_json:
<harnessVariable>{{durableConversationJson=[{"type":"user","content":[{"type":"text","text":"<user_query>\n...\n</user_query>"}],"prompt_index":0},{"type":"assistant","content":"...","model_id":"grok-4.7-build","reasoning_effort":"high"}]}}</harnessVariable>

---

# Prompt suggestion (`prompts/grok-prompt-suggestion.md`)

CWD: <harnessVariable>{{workspacePath=/Users/example/Developer/example-repo}}</harnessVariable>

Transcript:

<harnessVariable>{{transcript=User: <user_query>
...
</user_query>

Agent: ...}}</harnessVariable>

Predict the user's next message. Reply with ONLY the suggestion text.

---

# Turn summary (`prompts/grok-turn-summary.md`)

<user_message>
<harnessVariable>{{userMessage=<user_query>
...
</user_query>}}</harnessVariable>
</user_message>

<agent_reply>
<harnessVariable>{{agentReply=...}}</harnessVariable>
</agent_reply>
