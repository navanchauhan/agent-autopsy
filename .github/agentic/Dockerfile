# One image per provider run: the Claude Code driver plus the pinned target release.
# Base layers come from mirror.gcr.io so a Docker Hub outage cannot stop a run.

FROM mirror.gcr.io/library/node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        binutils ca-certificates curl file git gosu jq less procps python3 python3-pip \
        ripgrep tmux unzip xxd xz-utils \
    && python3 -m pip install --break-system-packages --no-cache-dir mitmproxy==11.0.2 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -s /bin/bash runner

# Driver: an exact native Claude Code release, verified against its signed manifest.
ARG DRIVER_URL
ARG DRIVER_SHA256
RUN test -n "$DRIVER_URL" && test -n "$DRIVER_SHA256" \
    && mkdir -p /opt/driver \
    && curl -fsSL --retry 3 "$DRIVER_URL" -o /opt/driver/claude \
    && echo "$DRIVER_SHA256  /opt/driver/claude" | sha256sum -c - \
    && chmod 0755 /opt/driver/claude

# Target: the release being archived. KIND is binary, tarball, npm, or none.
ARG TARGET_KIND=none
ARG TARGET_URL=
ARG TARGET_SHA256=
ARG TARGET_SHA512=
ARG TARGET_BIN=
ARG TARGET_TAR_MEMBER=
ARG TARGET_NPM=
RUN set -eu; mkdir -p /opt/target/bin; \
    verify() { \
      if [ -n "$TARGET_SHA256" ]; then echo "$TARGET_SHA256  $1" | sha256sum -c -; \
      elif [ -n "$TARGET_SHA512" ]; then echo "$TARGET_SHA512  $1" | sha512sum -c -; \
      else echo "no target digest" >&2; exit 1; fi; }; \
    case "$TARGET_KIND" in \
      binary) curl -fsSL --retry 3 "$TARGET_URL" -o /tmp/target && verify /tmp/target \
              && install -m 0755 /tmp/target "/opt/target/bin/$TARGET_BIN" ;; \
      tarball) curl -fsSL --retry 3 "$TARGET_URL" -o /tmp/target.tgz && verify /tmp/target.tgz \
              && mkdir -p /opt/target/pkg && tar -xzf /tmp/target.tgz -C /opt/target/pkg \
              && install -m 0755 "/opt/target/pkg/$TARGET_TAR_MEMBER" "/opt/target/bin/$TARGET_BIN" ;; \
      npm) npm install -g --prefix /opt/target "$TARGET_NPM" && npm cache clean --force ;; \
      none) ;; \
      *) echo "unknown TARGET_KIND $TARGET_KIND" >&2; exit 1 ;; \
    esac; rm -f /tmp/target /tmp/target.tgz

ENV PATH="/opt/target/bin:${PATH}" \
    DISABLE_AUTOUPDATER=1 \
    AGY_CLI_DISABLE_AUTO_UPDATE=1

COPY .github/agentic/record.py /opt/agentic/record.py
COPY .github/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod 0755 /usr/local/bin/docker-entrypoint.sh
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/bin/bash"]
