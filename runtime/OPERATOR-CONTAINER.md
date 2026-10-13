# Independent operator container recipe

This historical generic recipe remains reviewable. Current version0.3.1-e3.5 local artifact assembly uses the cached verified Node22.23.2 image digest83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5, exact public Kit alpha.16 and the locked portable public dependency graph. The versioned operator artifact receipt records build, synthetic health and immutable archive hashes. Root owns staging/deployment and provider acceptance; prior release artifacts remain immutable.

Use Dockerfile.operator with the exact new standalone npm-style runtime-artifact.tgz. The artifact includes its exact public Kit tar and frozen pnpm lock; all installed libraries are public dependencies. The build installs pnpm10.33.0 and production dependencies with frozen lock/ignore-scripts; host source/node_modules, private DB code, author modules and host keys never enter it. Replace NODE_IMAGE's tag with root's verified official digest before build. Supply mode0600 private operator configuration and Google/channel files outside image/source, owned by the node service UID. Pre-create persistent store parent/root mode0700 on a local filesystem with matching UID; keep app-owned encryption key/key ID and state under explicit operator backup custody. No key is generated/exported by this recipe.

For the current single-host Caddy candidate, a separate independently operated runtime container can join --network container:app-caddy-1. It still binds127.0.0.1:4082 inside that network namespace; Caddy can reach it there. Mount only runtime private operator files and its own persistent state, never host runtime keys or source. Preserve one writer across restarts; no automatic orphan takeover.

Root may review an exact Caddy route equivalent to:

```
@email_runtime path /v1/connections /v1/data
reverse_proxy @email_runtime 127.0.0.1:4082
```

Place these exact routes before the application's catch-all proxy. Preserve path, prohibit redirects and request/auth/body logging, and permit the explicit public binary/request/result budgets. Register https://demo.deft.ing/v1/connections as the exact reviewed connection endpoint; the public data port is the same reviewed origin plus/v1/data. HTTPS transport authentication and online host authority remain required. Caddy exposure alone grants no owner account/data/action consent.

The runtime CLI automatically polls explicitly enrolled runtime_channel_files through public claim/start/authorize/result. Each released Send or Organize still requires current exact human review, data/account/action authority and app-owned snapshot reservation. No provider effect can run through an independently callable HTTP Send endpoint. Operator removal/revocation must preserve encrypted unknown journals and fence writer leases before cutover. Full fields, limits and recovery semantics are in DEPLOYMENT.md.
