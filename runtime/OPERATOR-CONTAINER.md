# Independent Runtime operator container

The supported Runtime source is `0.4.0-preview.15` with public Kit `0.1.0-alpha.35`. Use the exact source/archive/Node base image pins in the [compatibility manifest](../release/compatibility.json); the App independently uses Kit38. The complete [setup guide](../docs/setup.md) is the current operator path.

## Build from public source

Use `Dockerfile.operator` with the deterministic `runtime-artifact.tgz`. The archive includes its exact public Kit tarball and frozen pnpm lockfile. The build requires an explicit `NODE_IMAGE` official image digest and installs pnpm10.33.0 plus production dependencies with frozen lock/ignore-scripts. Its supported Node baseline is >=22.13.0; use the exact tested base from the release record, not the Dockerfile's historical comment or a floating tag.

```sh
docker build -f runtime/Dockerfile.operator \
  --build-arg NODE_IMAGE='node:24.14.0-bookworm-slim@sha256:4bd6219054c8bebcd26a66bfd8ca0bd6e1024b4b97474c59bb7ee3bbcbef4fe8' \
  -t deft-email-runtime:0.4.0-preview.15 .
```

The command pins the registry-verified Node24.14.0 Debian slim linux/amd64 platform image. The final release record binds its Runtime build to the selected base and evidence; do not substitute a different platform or floating tag.

Run this in the operator build directory containing the checksum-verified archive and the corresponding Dockerfile at `runtime/Dockerfile.operator`. The `runtime/` archive prefix matches the Dockerfile extraction. Host source, Host `node_modules`, private database code and keys are not build inputs. Provider credentials, private configuration and mailbox state never enter the image.

If using a prebuilt Runtime image, verify its digest/source against the compatibility record instead. Historical E5.8/E5.9 derivative recipes are retained evidence; they are not this release's consumer build instructions.

## Operate one writer

Supply mode0600 private operator configuration and Google/channel files outside the image, owned by the Runtime service UID. Pre-create its persistent store parent/root mode0700 on a local POSIX filesystem with the matching UID. Preserve the encrypted state, encryption key/key ID and backup custody. Never run two Runtime writers against that store, including during upgrades.

The listener binds loopback. Put it behind reviewed HTTPS routing; a separate container may share the reverse proxy's network namespace so the proxy reaches its loopback listener. Do not assume a demo container name or copy another installation's registration.

A Caddy route can use:

```caddy
@email_runtime path /v1/connections /v1/data
reverse_proxy @email_runtime 127.0.0.1:4082
```

Place the routes before the Host catch-all. Preserve paths, avoid redirects and authorization/body logging, and configure the bounded request/result sizes required by the released contract. Register the actual `https://YOUR_RUNTIME_HOST/v1/connections` endpoint; the data endpoint uses the same reviewed origin at `/v1/data`. HTTPS exposure alone grants no account, data or action consent.

The Runtime CLI polls enrolled `runtime_channel_files` through public claim/start/authorize/result. Each released Send or Organize requires current reviewed authority and its immutable app-owned snapshot. There is no independently callable HTTP Send endpoint. Enroll the separate observation/publication lane for Task/Knowledge as described in [setup](../docs/setup.md#task-and-knowledge-integration).

After restart, verify channel consumers and Host authority as well as HTTP health. Preserve unknown journals and fence writer leases before cutover. Detailed field/recovery reference is in [DEPLOYMENT.md](DEPLOYMENT.md); older E3/Graph notes describe their historical implementation stages rather than the supported provider matrix.
