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

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        gnupg \
        gosu \
        jq \
        python3 \
        python3-pip \
        python3-venv \
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

# mitmproxy (grok/misc/scripts/mitm-capture-grok.py) — installed system-wide (not
# per-user pipx) so it works the same regardless of which user ends up running it.
RUN python3 -m pip install --break-system-packages mitmproxy

# --- Non-root user for actually running the CLIs -----------------------------
#
# Claude Code and Grok both refuse to honor --dangerously-skip-permissions /
# interactive-auth flags when running as root (a real safety check, not a bug —
# confirmed by hitting it during this pipeline's first live dry run). So the
# capture pipeline itself runs as this user, not root.
#
# The container's own default user stays root (see ENTRYPOINT below): the
# entrypoint chowns the bind-mounted /workspace to this user (regardless of
# whatever uid actually owns those files on the mounting host — root can always
# chown) and then drops privileges via `gosu` to run the actual pipeline. This
# avoids having to guess or match any particular host uid.
RUN useradd -m -s /bin/bash runner

USER runner
WORKDIR /home/runner

# npm's default global prefix is a root-owned system directory. Codex's own
# `codex update` re-runs `npm install -g @openai/codex`, which would otherwise
# fail with EACCES for a non-root user (confirmed by hitting exactly this in
# this pipeline's second live dry run) — so give `runner` its own writable
# global prefix before installing Codex into it.
RUN mkdir -p /home/runner/.npm-global \
    && npm config set prefix /home/runner/.npm-global
ENV PATH="/home/runner/.npm-global/bin:${PATH}"

# Codex CLI (OpenAI) — official npm package, same as this repo's own dev-machine install.
RUN npm install -g @openai/codex

# Claude Code — official native installer (curl -fsSL https://claude.ai/install.sh),
# confirmed against Anthropic's own docs at code.claude.com/docs/en/setup.
RUN curl -fsSL https://claude.ai/install.sh | bash

# Antigravity CLI — official installer, already documented in this repo's own
# antigravity/VERSION (installer_url).
RUN curl -fsSL https://antigravity.google/cli/install.sh | bash

# Grok CLI — official installer, confirmed against xAI's own docs.x.ai/build/overview.
RUN curl -fsSL https://x.ai/cli/install.sh | bash

USER root
WORKDIR /workspace

COPY .github/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/bin/bash"]
