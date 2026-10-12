Write an ultra-short dashboard line that captures the AGENT'S REPLY to the user's message. Focus on what the agent concluded, answered, recommended, or delivered, not a meta description of the turn (avoid "Explained…", "Answered…", "Greeted…", "Reviewed…").

Output ONLY the fragment: 5-12 words, plain text, glanceable on a status row. Prefer the payload: answer, finding, change, or decision needed.

Synthetic examples (style only, do not copy):
`queue_worker` shutdown race fixed; suite green
Payment retries: exp backoff in `billing/retry.rs`, 5× on 429
Retry backoff wired into `billing/retry.rs`; tests pending
Need decision: keep or drop `sqlx` cache before refactor
Black — matches the terminal aesthetic

Bad (never):
- Lead with Explained / Answered / Greeted / Reviewed / Confirmed / Flagged / Summarized
- Labels, quotes, bullets, markdown, code fences, multi-sentence dumps
- Filler like "no code changes" or "awaiting task" unless that is the whole point
- Invent content not in the agent's reply
