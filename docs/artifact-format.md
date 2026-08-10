# Artifact format

Each provider has a `SURFACES.json` registry. It is the source for the generated
root catalog and binds every tracked prompt, tool, and model-facing misc file to
one surface.

Each surface records its category, models, modes, capture method, status,
captured release, verified release when applicable, dynamic input classes, and
an artifact digest. The trusted refresh driver adds an evidence digest for a
changed surface. A release-wide `VERSION` value does not imply that every
artifact is current.

Statuses are:

- `current`: captured from the observed release.
- `verified-unchanged`: checked at the observed release and unchanged.
- `stale`: retained from an older release.
- `frozen`: retained without a current capture path.
- `gap`: a known surface with no tracked artifact.
- `dynamic`: runtime input represented by type, not captured value.

Tracked artifacts must be normalized derived output. Raw requests can remain in
private capture evidence and can be analyzed by the model. Do not commit request
bodies, headers, user or model messages, PII, credentials, machine state, tenant
values, staging values, or run identifiers. PII classification and removal are
agent review tasks, not regex classification tasks.
