# Capture credentials

The workflow uses the `agent-autopsy-capture` GitHub environment. It expects
isolated provider credentials for the Codex driver, Claude Code, Grok, and
Antigravity. It also uses a narrow repository token with `Environments: Read and
write` to rotate environment secrets. Do not use a personal everyday account.

Credentials are decoded only into narrow temporary mounts. Provider jobs receive
only their own login. Model-generated commands cannot read the Codex auth file or
credential mount. A fixed host-side preflight validates secret rotation before
capture or model work starts.

Repository and organization secrets are fixed when a workflow is queued, but
environment secrets load when the environment job starts. Store rotating copies
in the environment so later jobs and later runs receive the refreshed value.
Never add decoded credentials, trace headers, or raw request files to Git.
