# Runtime for the capture and agent-driven refresh pipeline.

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
        ripgrep \
        tmux \
        unzip \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Node.js runs the extractors and Codex CLI.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI publishes releases and rotates repository secrets.
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Grok capture uses mitmproxy.
RUN python3 -m pip install --break-system-packages --no-cache-dir mitmproxy

# Capture CLIs require a non-root runtime. The entrypoint fixes bind-mount
# ownership before dropping from root to this user.
RUN useradd -m -s /bin/bash runner

USER runner
WORKDIR /home/runner

# Keep global npm installs writable by the runtime user.
RUN mkdir -p /home/runner/.npm-global \
    && npm config set prefix /home/runner/.npm-global
ENV PATH="/home/runner/.npm-global/bin:${PATH}"

RUN npm install -g @openai/codex \
    && npm cache clean --force

RUN curl -fsSL https://claude.ai/install.sh | bash

RUN curl -fsSL https://antigravity.google/cli/install.sh | bash

RUN curl -fsSL https://x.ai/cli/install.sh | bash

USER root
WORKDIR /workspace

RUN ln -s /home/runner/.grok/bin/grok /usr/local/bin/grok

COPY .github/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/bin/bash"]
