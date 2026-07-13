# Amp Code

> **Status: frozen.** Tool schemas reflect Amp `0.0.1783542413-gb55c7a`; prompt files were last verified with `0.0.1779927513-g17febb` and should be treated as stale.

## Source method

`tools/` comes from `amp tools list --json` and `amp tools show <name> --json` across smart, deep, large, and rush modes. The checked-in prompts came from the former local `tools list --inspect --json` path, using a temporary patched binary that bypassed only its client-side permission gate. No patched binary or raw trace is stored.

## Refresh tool schemas

Capture into scratch space, then compare `tools/` and the stable fields in `VERSION` before updating this directory:

```sh
amp --version
repo_root=$PWD
scratch_root=${CAPTURE_SCRATCH_DIR:-$repo_root/.capture-scratch}
out_dir="$scratch_root/ampcode/candidate"
mkdir -p "$out_dir"
node ampcode/misc/scripts/extract-amp-tools.cjs "$out_dir"
diff -ru ampcode/tools "$out_dir/tools" || true
```

Schema text must remain exact. Use the recorded `modes` or `variants[]` metadata to preserve real mode differences; do not retain temporary trace paths or credentials.

## Active limitation

Amp removed the `--inspect` option, leaving no local code path that emits the assembled system prompt. Network capture also cannot recover it: the client sends environment snapshots and local tool registrations to a server-side thread actor, while the actor assembles the prompt and calls the model without returning that request to the client.

Do not regenerate `prompts/` from inferred server state. Revisit prompt capture only if Amp restores a local inspection API or exposes the model-facing request in its protocol.
