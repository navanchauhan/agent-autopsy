# Contributing

Update the smallest provider-specific artifact set supported by direct source or
model-request evidence. Preserve product-owned text exactly and normalize only
runtime values. Update the provider `VERSION` and `SURFACES.json`; do not label
an older artifact current or hide a missing surface.

Before opening a change, run:

```sh
node .github/scripts/update-surface-hashes.cjs <provider>
node .github/scripts/generate-catalog.cjs
node .github/scripts/validate-surfaces.cjs
node --test .github/scripts/test-*.cjs
```

Do not commit raw requests, credentials, PII, private paths, tenant or staging
values, or run identifiers. Raw evidence can be shared with the private analysis
model, but the reviewed patch must contain only normalized derived artifacts.
