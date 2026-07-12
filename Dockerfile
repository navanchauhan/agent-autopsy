# Runtime image for the daily capture-refresh pipeline (.github/workflows/daily-refresh.yml).
#
# Bundles the four supported coding-agent CLIs (Claude Code, Codex, Antigravity, Grok)
# plus git/gh/tmux/mitmproxy/node so a single container can check for new releases,
# re-run each tool's already-documented capture flow (see <tool>/README.md "Refresh
# commands"), and hand the diffing/rewrite work to `codex exec`.
#
# Versions are intentionally NOT pinned at build time: each tool's own `update`
# subcommand is run at the start of every workflow run (see .github/scripts/
# check-versions.sh), so "latest" always reflects the day of the run, not the day
# the image layer was cached.

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/root \
    PATH="/root/.local/bin:/root/.grok/bin:/root/.local/share/claude/bin:${PATH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        gnupg \
        jq \
        python3 \
        python3-pip \
        python3-venv \
        pipx \
        tmux \
        unzip \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Node.js (needed to run this repo's misc/scripts/*.cjs extraction scripts, and to
# install Codex via npm) — official NodeSource distribution, per nodejs.org's own
# documented install instructions.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI — official apt repo, per cli.github.com's own documented install instructions.
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# mitmproxy (grok/misc/scripts/mitm-capture-grok.py) — installed via pipx since Debian's
# system Python is externally-managed (PEP 668) and this must not touch apt's own python deps.
RUN pipx install mitmproxy \
    && pipx ensurepath

# --- Coding-agent CLIs -------------------------------------------------------

# Codex CLI (OpenAI) — official npm package, same as this repo's own dev-machine install.
RUN npm install -g @openai/codex

# Claude Code (Anthropic) — official native installer (curl -fsSL https://claude.ai/install.sh),
# confirmed against Anthropic's own docs at code.claude.com/docs/en/setup.
RUN curl -fsSL https://claude.ai/install.sh | bash

# Antigravity CLI (Google) — official installer, already documented in this repo's own
# antigravity/VERSION (installer_url).
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash

# Grok CLI (xAI) — official installer, confirmed against xAI's own docs.x.ai/build/overview.
RUN curl -fsSL https://x.ai/cli/install.sh | bash

WORKDIR /workspace

CMD ["/bin/bash"]
