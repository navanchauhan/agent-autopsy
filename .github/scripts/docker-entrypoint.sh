#!/bin/bash
# Container entrypoint. Always starts as root (the image's actual default user),
# fixes ownership of the bind-mounted /workspace to the built-in `runner` user
# (root can always chown, regardless of what uid actually owns those files on
# the mounting host), then drops privileges to run the real command as `runner`
# — this is the standard pattern for running a bind-mounted host checkout as a
# non-root container user without having to guess or match the host's uid.
#
# `runner`'s HOME and PATH (including the CLIs installed under
# /home/runner/.local/bin and /home/runner/.grok/bin during the image build)
# are set explicitly since gosu, unlike su/sudo, deliberately does NOT reset
# the environment — so anything not set here would otherwise leak root's
# environment into the runner-owned process.

set -euo pipefail

if [ -d /workspace ]; then
  chown -R runner:runner /workspace
fi

export HOME=/home/runner
export PATH="/home/runner/.local/bin:/home/runner/.grok/bin:${PATH}"

exec gosu runner env HOME="$HOME" PATH="$PATH" "$@"
