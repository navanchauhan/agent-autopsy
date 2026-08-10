# Agent Autopsy

Agent Autopsy is a versioned archive of model-facing prompts, tool schemas, and
steering surfaces from coding-agent CLIs. It shows what each product sends to a
model, which release supports each artifact, and what is still unknown.

Start with the [cross-provider catalog](CATALOG.md). It lists every known surface
for Codex, Claude Code, Grok, Antigravity, and Amp, including explicit gaps and
dynamic inputs.

## Providers

| Provider | Capture source | Freshness |
| --- | --- | --- |
| [Codex](codex/README.md) | Tagged open-source tree | Active |
| [Claude Code](claude-code/README.md) | Traced `/v1/messages` requests | Mixed; see per-surface status |
| [Grok](grok/README.md) | Source inspection and traced `/v1/responses` requests | Active |
| [Antigravity](antigravity/README.md) | Parsed Cortex request logs | Active |
| [Amp](ampcode/README.md) | Local inspection | Frozen |

## How to read the archive

- `prompts/` contains system prompts or source-derived prompt templates.
- `tools/` contains exact observed tool schemas and model or mode variants.
- `misc/` contains steering and other model-facing artifacts.
- `VERSION` records provider-level capture facts.
- `SURFACES.json` records per-surface coverage, capture release, status, and hashes.

Runtime values use `<harnessVariable>{{name=example}}</harnessVariable>`. A
`current` surface was captured at the observed release. `verified-unchanged` was
checked at that release. `stale` and `frozen` identify older artifacts. `gap`
means that a known surface is absent. `dynamic` identifies a typed runtime input
that must not be mistaken for fixed product text.

## Trust and privacy

Raw requests are private evidence and can be used by the analysis model. They
are not repository artifacts. The author agent semantically removes personal
identity data, private home paths, tenant or staging values, run IDs, and user
content. An independent reviewer agent must attest that PII was removed before
publication. Product-owned prompt and schema text stays exact; only
runtime-specific values are normalized.

Run the local integrity checks with:

```sh
node .github/scripts/validate-surfaces.cjs
node .github/scripts/generate-catalog.cjs --check
```

See [artifact format and status rules](docs/artifact-format.md), [automation](docs/automation.md),
[capture credentials](docs/capture-credentials.md), and [contributing](CONTRIBUTING.md).
