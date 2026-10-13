# Independent operator container recipe

Current Runtime candidate is `0.3.1-e5.9`, retaining Node22.23.2, public Kit alpha.32 and the frozen dependency graph from exact E5.8. The four executable-module fix accepts contract-valid Host connection UUIDs (including retained reattach UUIDv5) while draft/file identifiers remain UUIDv4. The release's Runtime delta/build receipts record each changed module and immutable image/source identity; vendor provenance57 stays unchanged.

The audited derivative recipe loads the exact public E5.8 base archive, checks its portable configuration and all RootFS layers, and copies only pinned changed source/package/tests. It uses no build network or dependency installation. The full-source Dockerfile.operator instead requires an explicit verified official Node22.23.2 image digest via NODE_IMAGE; no default Node24 upgrade is implied. Operator state, keys and private files never enter either build.

Use Dockerfile.operator with the deterministic runtime-artifact.tgz. The artifact includes its exact public Kit tar and frozen pnpm lock; all installed libraries are public dependencies. The build installs pnpm10.33.0 and production dependencies with frozen lock/ignore-scripts; host source/node_modules, private DB code, author modules and host keys never enter it. Replace NODE_IMAGE's tag with root's verified official digest before build. Supply mode0600 private operator configuration and Google/channel files outside image/source, owned by the node service UID. Pre-create persistent store parent/root mode0700 on a local filesystem with matching UID; keep app-owned encryption key/key ID and state under explicit operator backup custody. No key is generated/exported by this recipe.

For the current single-host Caddy candidate, a separate independently operated runtime container can join --network container:app-caddy-1. It still binds127.0.0.1:4082 inside that network namespace; Caddy can reach it there. Mount only runtime private operator files and its own persistent state, never host runtime keys or source. Preserve one writer across restarts; no automatic orphan takeover.

Root may review an exact Caddy route equivalent to:

```
@email_runtime path /v1/connections /v1/data
reverse_proxy @email_runtime 127.0.0.1:4082
```

Place these exact routes before the application's catch-all proxy. Preserve path, prohibit redirects and request/auth/body logging, and permit the explicit public binary/request/result budgets. Register https://demo.deft.ing/v1/connections as the exact reviewed connection endpoint; the public data port is the same reviewed origin plus/v1/data. HTTPS transport authentication and online host authority remain required. Caddy exposure alone grants no owner account/data/action consent.

The runtime CLI automatically polls explicitly enrolled runtime_channel_files through public claim/start/authorize/result. Each released Send or Organize still requires current exact human review, data/account/action authority and app-owned snapshot reservation. No provider effect can run through an independently callable HTTP Send endpoint. Operator removal/revocation must preserve encrypted unknown journals and fence writer leases before cutover. Full fields, limits and recovery semantics are in DEPLOYMENT.md.
