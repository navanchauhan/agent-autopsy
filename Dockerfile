# Provider-isolated runtimes for the capture and normalization pipeline.

FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241 AS base

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        gosu \
        jq \
        nodejs \
        npm \
        ripgrep \
        tmux \
        unzip \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash runner

USER runner
WORKDIR /home/runner
RUN mkdir -p /home/runner/.npm-global /home/runner/.local/bin \
    && npm config set prefix /home/runner/.npm-global
ENV PATH="/home/runner/.local/bin:/home/runner/.grok/bin:/home/runner/.npm-global/bin:${PATH}"

USER root
WORKDIR /workspace
COPY .github/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/bin/bash"]

# Codex is the only model-running component. It is isolated from provider
# credentials and from the repository-secret-management token.
FROM base AS driver
USER runner
ARG CODEX_CLI_VERSION=0.146.0
RUN test -n "${CODEX_CLI_VERSION}" \
    && npm install -g "@openai/codex@${CODEX_CLI_VERSION}" \
    && npm cache clean --force
USER root

# Claude's signed release manifest supplies this exact binary and checksum.
FROM base AS capture-claude-code
USER runner
ARG CLAUDE_CODE_ARTIFACT_URL
ARG CLAUDE_CODE_ARTIFACT_SHA256
RUN test -n "${CLAUDE_CODE_ARTIFACT_URL}" \
    && test -n "${CLAUDE_CODE_ARTIFACT_SHA256}" \
    && curl -fsSL --connect-timeout 10 --max-time 300 "${CLAUDE_CODE_ARTIFACT_URL}" -o /tmp/claude \
    && printf '%s  %s\n' "${CLAUDE_CODE_ARTIFACT_SHA256}" /tmp/claude | sha256sum -c - \
    && install -m 0755 /tmp/claude /home/runner/.local/bin/claude \
    && rm -f /tmp/claude
USER root

# MITM capture dependencies are shared only by the two providers that need
# them; a failure here cannot block Claude, Codex source capture, or caches.
FROM base AS proxy-base
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
    && python3 -m pip install --break-system-packages --no-cache-dir mitmproxy==11.0.2 \
    && rm -rf /var/lib/apt/lists/*

FROM proxy-base AS capture-grok
USER runner
ARG GROK_CLI_ARTIFACT_URL
ARG GROK_CLI_ARTIFACT_SHA256
RUN test -n "${GROK_CLI_ARTIFACT_URL}" \
    && test -n "${GROK_CLI_ARTIFACT_SHA256}" \
    && mkdir -p /home/runner/.grok/bin \
    && curl -fsSL --connect-timeout 10 --max-time 300 "${GROK_CLI_ARTIFACT_URL}" -o /tmp/grok \
    && printf '%s  %s\n' "${GROK_CLI_ARTIFACT_SHA256}" /tmp/grok | sha256sum -c - \
    && install -m 0755 /tmp/grok /home/runner/.grok/bin/grok \
    && rm -f /tmp/grok
USER root

FROM proxy-base AS capture-antigravity
USER runner
ARG ANTIGRAVITY_TARBALL_URL
ARG ANTIGRAVITY_TARBALL_SHA512
RUN test -n "${ANTIGRAVITY_TARBALL_URL}" \
    && test -n "${ANTIGRAVITY_TARBALL_SHA512}" \
    && curl -fsSL --connect-timeout 10 --max-time 300 "${ANTIGRAVITY_TARBALL_URL}" -o /tmp/antigravity.tar.gz \
    && printf '%s  %s\n' "${ANTIGRAVITY_TARBALL_SHA512}" /tmp/antigravity.tar.gz | sha512sum -c - \
    && tar -xzf /tmp/antigravity.tar.gz -C /tmp antigravity \
    && install -m 0755 /tmp/antigravity /home/runner/.local/bin/agy \
    && rm -f /tmp/antigravity /tmp/antigravity.tar.gz
USER root

# Keep a useful default target for local `docker build` invocations.
FROM driver AS runtime
