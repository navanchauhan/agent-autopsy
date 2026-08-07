# Agent Autopsy

Archive of model-facing prompts and tool schemas from coding-agent CLIs.

## Archive format

- `prompts/` contains captured system prompts or source-derived prompt templates.
- `tools/` contains one JSON file per observed tool. `schema` values are exact model-facing payloads; `variants[]` preserves payload differences by model or capture mode.
- `misc/` contains captured steering messages and the scripts used to collect or extract artifacts.
- `VERSION` records the current captured source version, provenance, active limitations, and artifact counts.

Run-specific values are replaced with `<harnessVariable>{{name=example}}</harnessVariable>`. Repeated runtime sections use `{{#each collectionName}}...{{/each}}` inside a harness-variable block.

## Agents

| Agent | Source method | Status |
| --- | --- | --- |
| [Codex](codex/README.md) | Direct extraction from the open-source Codex tree | Active |
| [Claude Code](claude-code/README.md) | Traced Anthropic `/v1/messages` requests | Active; some capture modes lag the current binary |
| [Antigravity CLI](antigravity/README.md) | Parsed verbose `Cortex API Request` logs | Active |
| [Grok CLI](grok/README.md) | Redacted mitmproxy capture of `/v1/responses` | Active |
| [Amp Code](ampcode/README.md) | Local tool inspection and prior prompt inspection | Frozen; prompt capture is unavailable |

## Capture integrity

- Preserve model-facing prompt and schema text exactly. Normalize only host-, user-, session-, or request-specific values.
- Keep distinct payloads as variants rather than merging meaningful differences.
- Treat timestamps, trace filenames and line numbers, temporary paths, locally installed skills, and machine-specific MCP state as provenance noise unless they alter the product-owned payload.
- Never commit raw traces or credentials. Capture scripts must redact authentication material before an artifact is retained.
- READMEs describe the current method and active limitations. Git history and releases record past changes.

## Automated refresh

`.github/workflows/daily-refresh.yml` polls stable upstream releases hourly without making a model call. Every validated target is added to a durable per-tool FIFO in the `automation/release-state` branch, alongside recapture state. Only the exact head of each queue is emitted for capture, and that head remains pinned until the corresponding committed `VERSION` advances. A newer release therefore cannot displace an older unpublished release. The state branch is separate from the default branch so polling does not create user-facing archive commits.

The four active providers run as an independent, fail-fast-disabled matrix with at most four workers. Each worker is bound to a canonical plan containing the exact release, source revision where available, artifact digest, and capture-contract hash. Codex is extracted from its matching `rust-v<version>` source tag; Claude uses a preloaded request tracer and tmux PTY harness; Grok and Antigravity use response-validated mitmproxy harnesses. A rerun can replay the newest eligible, digest-verified capture bundle from an earlier attempt of the same workflow run. Incomplete providers stop before normalization and remain queued, while complete providers can continue independently.

After capture, one serial Codex author normalizes all ready evidence and a separate read-only Codex reviewer gates material changes. The driver uses the repository's last approved Codex CLI, not the newly observed Codex target, and runs in short-lived containers with credentials denied to model-generated shell commands. If the author produces no scoped diff, the workflow writes a deterministic retry result and stops before spending reviewer tokens. A successful publication applies the exact reviewed binary patch, creates one atomic commit and annotated tag, pushes them atomically, and creates release notes mechanically from version transitions and reviewed file changes. Model-authored prose is not used as permanent release metadata.

Validated captures, exact Codex/Grok source checkouts, image build layers, and approved Codex decisions are cached by their exact inputs. The Codex decision identity includes the driver contract, model settings, per-tool baseline tree, release plan, and evidence. Rejected captures and safe no-op decisions early-stop within aligned cooldown buckets (daily by default); `workflow_dispatch` with `force_capture` bypasses the positive and retry caches. Credentials and raw unvalidated traces are never cached.

Amp remains excluded while its prompt capture is unavailable.

## Capture credentials

Create a GitHub environment named `agent-autopsy-capture` without required reviewers before enabling the workflow. The provider and Codex-driver jobs use that environment with deployment creation disabled, so environment secrets are loaded when each job starts rather than when the workflow is queued. This is important for OAuth files refreshed by an earlier run.

The capture jobs consume these secrets:

- `CODEX_CHATGPT_AUTH_JSON`: base64 of an isolated Codex `auth.json`, used only by the serial driver.
- `CLAUDE_CODE_OAUTH_TOKEN`: the long-lived setup token used by Claude print mode.
- `CLAUDE_CODE_CREDENTIALS_JSON`: optional base64 of a real isolated `~/.claude/.credentials.json`, used and rotated for interactive mode.
- `GROK_AUTH_JSON`: base64 of `~/.grok/auth.json`.
- `ANTIGRAVITY_GEMINI_CREDS`: base64 tar containing only `antigravity-oauth-token` and `installation_id`.
- `REPO_SECRETS_PAT`: a fine-grained personal access token whose resource owner contains this repository, whose repository access is limited to `agent-autopsy`, and whose repository permission **Environments** is set to **Read and write**. GitHub's separate **Secrets** permission is not sufficient for `gh secret set --env`. The token is available only to fixed host-side persistence and preflight steps and is never passed to a provider or Codex model process.

Store `REPO_SECRETS_PAT` as a repository secret, not as a rotating environment credential. An existing fine-grained token can be kept and granted the **Environments: Read and write** permission; its existing **Secrets** permission may remain if another workflow needs it, but this workflow does not use it to rotate credentials. A classic PAT with `repo` scope also works for the environment-secret API, but it is substantially broader and is not recommended. The workflow's automatic `GITHUB_TOKEN` cannot replace this token because `Environments` is not an available `GITHUB_TOKEN` workflow permission.

For initial bootstrap, store the login values as repository secrets; if an environment secret of the same name is absent, the repository value remains available to the environment job. After a successful capture, a fixed host-side step validates the refreshed credential and writes the rotating copy into `agent-autopsy-capture`, where it takes precedence on later job starts. Repository and organization secrets are snapshotted when a workflow is queued, while environment secrets are loaded when each referencing job starts; falling back to repository-secret rotation would therefore make already-queued runs use stale OAuth state. Rotation is never used as same-run job communication. After exact releases have been durably queued, a dedicated preflight job writes and deletes a uniquely named canary environment secret before any capture or model call. This proves the full rotation path; a token with only **Secrets: Read and write** or **Environments: Read** fails before model tokens can be spent.

Each isolated provider exports only its own refreshed login into a narrow runner-temp mount. The Codex ChatGPT login is decoded on the host, never placed in the model container environment, and mounted only for the parent CLI. Named Codex permission profiles deny model-generated commands access to both `auth.json` and the credential mount. Author and reviewer use separate containers, with a zero-token sandbox preflight before the first model call. A provider credential-persistence failure converts that provider to a retry; Codex-driver persistence failure blocks publication.
