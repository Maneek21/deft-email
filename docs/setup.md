# Developer-preview setup

Use the exact Apps-enabled Host and public artifacts in [the authoritative compatibility record](https://github.com/Maneek21/deft-email/releases/download/v1.9.0-preview.17/compatibility.json). The supported Host requires schema **120** and the matching generic contracts, not merely an older compatible-looking release label. Check the record's publication state and download hashes before starting. [Verification](verification.md) distinguishes previous demo evidence from final public acceptance.

The external consumer path is: obtain compatible Deft → independently build Email → sideload/review it → configure the separately operated Runtime, HTTPS/OAuth and authority → use Email and source integrations → [upgrade Email against the same Host](independence-upgrade.md). This requires operator work; no Deft source checkout, private import, native Email adapter or SQL patch is part of the Email installation.

Build Email in its own extracted public-source directory using the [README commands](../README.md#build-independently). The commands below use the Host's separately downloaded deployment-assets directory until the Runtime section. Keep these two directories distinct. Older E3/Graph implementation notes under `runtime/` are historical references, not this release's version/provider matrix.

## Start an isolated compatible Deft

Download and checksum-verify the published deployment assets for the exact prebuilt Host named in the compatibility record. The author builds Email outside Deft; a Host source checkout is needed only if the operator chooses to rebuild the Host. These commands are for a fresh POSIX Docker installation in the deployment-assets directory. Keep its project name, database, uploads volume and secrets separate from every existing workspace:

The current Host allows initial organization signup only while its database has no organization. Inviting another user into an existing organization does not create a fresh workspace. Uploading `io.deft.email` into an organization that already installed it follows the upgrade path, so it cannot prove a fresh installation. Use a separate fresh database and Runtime custody for the new-developer rehearsal.

A separate physical server or new DNS name is not required. An operator may serially route an existing approved HTTPS origin to the isolated Host, using the same allowlisted OAuth callback/client, while the original Host and its Runtime have no active work. Keep the original database, configuration and custody intact, route only one Host at a time, and restore the original routing afterwards. Keep the isolated Compose network private; if attaching a proxy network, use unique Host/database service names and explicit upstreams so service aliases cannot collide with the original deployment. Record that this is a fresh database and installation on shared infrastructure; do not claim a second workspace in the original database or concurrent account writers.

```sh
cp default.env.example .env
mkdir -p private
chmod 700 private
```

Use independently generated random `JWT_SECRET` and `JWT_REFRESH_SECRET` values of at least 32 characters each, without surrounding whitespace. They must differ and must not be development defaults or example placeholders; production startup rejects unsafe values. Existing valid keys remain unchanged during an upgrade.

Fill `.env` with fresh `POSTGRES_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET` and `ENCRYPTION_KEY`, and set `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` to the browser-reachable rehearsal URLs. Set `DEFT_IMAGE=ghcr.io/maneek21/deft@sha256:...` using the exact `host.image_digest` in the downloaded compatibility manifest. Use the Host release's `self-hosting.md` and [HTTPS routing guide](https://github.com/Maneek21/Deft/blob/v0.3.0-preview.123/docs/self-hosting-vps-domain-https.md). Runtime callbacks and authority URLs require HTTPS; a plain localhost health check is not a connection proof.

Set `DEFT_RELEASE_VERSION` to `host.version` in the compatibility record (`0.3.0-preview.123` for this set). This reports the Host release identity; the independent `host.schema_version` remains `0.3.0-preview.120`. Do not conflate the image release with the database schema. Set these preview gates in the operator environment. A prebuilt browser bundle must already contain the matching `NEXT_PUBLIC_*` gates and public origin; runtime variables cannot enable a gate omitted from that build:

```dotenv
DEFT_APPS_ENABLED=true
NEXT_PUBLIC_FEATURE_APPS=true
NEXT_PUBLIC_FEATURE_APP_RESOURCE_SYNC=true
NEXT_PUBLIC_FEATURE_APP_ATTACHMENT_BROKER=true
DEFT_APP_RUNS_ENABLED=true
DEFT_APP_RUN_APP_ORIGIN_ENABLED=true
DEFT_APP_RUNTIME_CHANNEL_ENABLED=true
DEFT_APP_V5_RUNTIME_ACTIONS_ENABLED=true
DEFT_APP_RESOURCE_SYNC_CHANNEL_ENABLED=true
DEFT_APP_ATTACHMENT_BROKER_ENABLED=true
DEFT_APP_OWNER_CONNECTIONS_ENABLED=true
DEFT_APP_EXPERIENCE_RESOURCE_EXPOSURE_ENABLED=true
DEFT_APP_PRIVATE_STATE_ENABLED=true
DEFT_APP_RESOURCE_SYNC_SCHEDULER_ENABLED=false
DEFT_APP_CONNECTION_HTTP_CONFIG=/run/deft-email/connections.json
```

Generate and retain the purpose-separated Run keyring. This writes new secrets to a private file without printing them:

```sh
umask 077
node -e "const fs=require('node:fs'),c=require('node:crypto'),k=()=>c.randomBytes(32).toString('base64');fs.writeFileSync('private/run-keyring.env','DEFT_APP_RUN_KEYRINGS='+JSON.stringify({schema_version:'deft.app_run_keyring.v1',run_encryption:{current:'enc-v1',keys:{'enc-v1':k()}},receipt_signing:{current:'sig-v1',keys:{'sig-v1':k()}},fingerprint:{current:'fp-v1',keys:{'fp-v1':k()}}})+String.fromCharCode(10),{mode:0o600})"
cat private/run-keyring.env >> .env
chmod 600 .env
node -e "require('node:fs').writeFileSync('private/connections.json',JSON.stringify({schema_version:'deft.app_connection_http_registrations.v1',entries:[]}),{mode:0o600})"
```

Create `compose.email-preview.yml` beside the compatible Host's published deployment assets (`docker-compose.yml`), using its pinned prebuilt image. This is operator configuration; the Email author does not need a Host checkout or a source modification. Building Host from its corresponding source is an optional self-hosting choice.

```yaml
services:
  deft:
    volumes:
      - ./private:/run/deft-email:ro
```

Use the PostgreSQL 16 image configured in the selected Host's published deployment assets; record its resolved digest separately from the schema. Require `/health/ready` to report the expected schema. These fresh-database commands must not initialize or downgrade an existing database. A directory bind lets the operator atomically replace the registry file without exposing a truncated file to the Host.

Keep `compose.release.yml` in every command: it removes the source-build context and uses the digest-pinned image for `deft`, `init`, `doctor` and `smoke`. `compose.prod.yml` removes the database's host port. Then use the supported fresh-database init, which asserts freshness, runs `db:push-full`, and applies the production-safe seed. It does not seed demo users or native Email accounts:

```sh
dc() { docker compose -p email-preview-isolated -f docker-compose.yml -f compose.prod.yml -f compose.release.yml -f compose.email-preview.yml "$@"; }
dc pull
dc up -d postgres
dc run --rm init
dc up -d deft
dc run --rm doctor
dc run --rm smoke
```

Sign up normally at the rehearsal Host; its first human signup becomes owner. Do not use `db:seed:demo`, restore a demo database, or configure `DEFT_APP_CONNECTION_ADAPTERS_CONFIG`. This Email App uses the external HTTP connection registry below; it does not need a native Email adapter, native account, or copied mailbox/custody rows.

## Register and sideload

1. Build `app/app.deft.json` and retain its package/experience digests from `app/build-result.json`.
2. Open **Settings → Apps**, upload `app/app.deft.json`, inspect it, then stage it for explicit authority review. The App ID is `io.deft.email`; source code is not uploaded as executable Host code. This package is protocol 7: the UI stages through `POST /api/apps/blob/composition/stage`, reads `GET /api/apps/blob/composition/INSTALLATION_ID/context?app_version_id=VERSION_ID`, then uses `/review` and `/activate` under that same composition path. Use the exact current review request/digest supplied by Host. Staging grants no account access or action consent.
3. Do not substitute `/api/apps/stage`, `/api/app-runtime-review`, or the older `deft app install-local` tutorial for this protocol 7 path. The Kit CLI rebuilds a `deft.app.json` authoring project; this repository instead uses its custom `app/build.mjs` to produce the upload package.
4. After activation, obtain the new installation/version/package/grant pins from the Apps UI or its authenticated public context. Read `GET /api/apps/INSTALLATION_ID` for `{app: ...}` and its `active_grant_snapshot_id`, current version and lifecycle pins. `GET /api/apps/INSTALLATION_ID/grants` returns `{grants: {installation, versions, snapshots, ...}}`; read `grants.installation` and select `grants.snapshots` by its active snapshot ID. Do not read `installation` at the response top level. The protocol 7 Runtime setup context also returns the current grant digest/operator pins. Configure the external HTTP registry as below, then perform administrative admission and owner resource review. Bind only the IDs issued for this installation.
5. Enroll separate Read/data authority, human action consent and Send/Organize channel sessions through their public workflows. Runtime health or an admin declaration cannot grant a human action. Preserve the issued finite lease and exact technical renewal metadata; a finite renewal ceiling and an explicitly issued `until_revoked` lifetime differ as described below.

The clean consumer acceptance follows this sequence on an isolated compatible installation. A database row copied from the demo or a native Email route is not this workflow. Exact UI labels may change with the compatible Host build.

## Admit the external connection profile

The Host's private `DEFT_APP_CONNECTION_HTTP_CONFIG` is a deployment registry, not a browser upload or permission grant. For a Gmail rehearsal, replace `private/connections.json` with the following template after the App has activated. `ORG_UUID`, `INSTALLATION_UUID` and `OPERATOR_UUID` must identify the newly signed-up workspace and actual current operator. Generate a fresh reserved registration UUID for the initial profile/admission review; it is replaced by the public resource activation's issued ID before connecting.

```json
{
  "schema_version":"deft.app_connection_http_registrations.v1",
  "entries":[{
    "org_id":"ORG_UUID",
    "installation_id":"INSTALLATION_UUID",
    "runtime_registration_id":"RESERVED_FRESH_UUID",
    "runtime_epoch":1,
    "connection_protocol":"v2",
    "profile":{
      "schema_version":"deft.app_connection_profile.v1",
      "key":"gmail_readwrite",
      "provider_id":"gmail",
      "operator_user_id":"OPERATOR_UUID",
      "runtime_requirement_key":"sync_provider",
      "resource_key":"inbox",
      "action_keys":["mirror_drafts","organize_messages","send_message"],
      "authorization_origin":"https://accounts.google.com",
      "credential_custody":"runtime",
      "executable":false
    },
    "endpoint":"https://RUNTIME_HOST/v1/connections",
    "runtime_auth_token":"NEW_BASE64URL_SECRET_AT_LEAST_43_CHARACTERS",
    "authority_token_sha256":"sha256:SHA256_OF_DISTINCT_AUTHORITY_TOKEN"
  }]
}
```

Create both directional tokens with `node -e "require('node:fs').writeFileSync('TOKEN_FILE',require('node:crypto').randomBytes(32).toString('base64url'),{mode:0o600})"`, using a different private path for each. Hash the authority token's exact bytes with SHA256; retain that original token only in the Runtime's private configuration. Use the same runtime transport token in the Host entry and Runtime configuration. The profile digest is SHA256 of the Host Kit's `canonicalAppConnectionProfileJson(profile)`; it covers the operator and ordered action keys. Do not hash a differently formatted JSON document.

Use the normal signed-in owner/admin APIs, or the ordinary Email settings controls which invoke them, in this order:

| Step | Public endpoint and result |
|---|---|
| Administrative admission | `POST /api/app-owner-connections/admissions/review`, then `/admissions/activate`; input is the current installation/version/package/grant/lifecycle pins, `policy_key: personal_mailbox`, current operator and reviewed limits. Activation uses the returned review digest and explicit host-policy acceptance. |
| Read/resource consent | `GET /api/app-owner-connections/INSTALLATION_ID/context`; use the admitted policy's current `resource_request` for `POST /resources/review`, then `/resources/activate`. Choose the intended bounded `target_key`, finite expiry, limits and attachment policy. Activation issues the fresh `registration_id` and `binding_id`. |
| Deployment bind | Replace the reserved ID in the Host HTTP registry with that issued resource registration; retain its reviewed profile/transport and current epoch. Put the same resource registration, profile digest, target and `connection_protocol: v2` in Runtime config. Fresh resource activation starts epoch 1; renew/re-enroll against current Host state rather than assuming epoch 1 for an existing binding. |
| Owner Send/Organize | `POST /api/app-owner-connections/actions/review`, then `/actions/activate`, for each admitted action and the issued `owner_resource_binding_id`. These are distinct from Read and data-store consent. |
| Operator channel | In Settings → Apps → Email → **Action operator setup**, review operator setup and issue the provider credential. Protocol 7 uses `GET /api/apps/blob/composition/INSTALLATION_ID/runtime/context?app_version_id=VERSION_ID` and `POST /api/apps/blob/composition/runtime/reviews/prepare`, `/bindings/activate`, `/bindings/BINDING_ID/sessions`. Preserve each action registration and the once-issued session credential in a private channel file. |
| Connect and private records | Email → Accounts connects through `/api/app-connection-sessions/v2/begin` and `/v2/callback`. Email → Access reviews data-store consent through `/api/app-data/connections/SESSION_ID/consent/review` and `/activate`; `drafts` is required for Compose/save/files, and signatures/templates require their own consent when used. |

The review endpoints are relative to the authenticated rehearsal API origin. Copy current Host-issued review requests; do not invent grant snapshots or use a Runtime channel token as a human bearer. The underlying schemas live in the compatible Host's `app-owner-connection-contract.ts` and public Kit connection/data contracts. The Host registry's `/v1/connections` endpoint also supplies `/v1/data` at the same origin; a separate private data registration is not created.

## OAuth client

Create a Google OAuth client with the compatible Host's exact HTTPS callback `https://HOST/apps/connections/callback`. Put its client configuration in an absolute private file, e.g. `/etc/deft-email/google-client.json`:

```json
{"client_id":"ISSUED_GOOGLE_CLIENT_ID","client_secret":"ISSUED_GOOGLE_CLIENT_SECRET","redirect_uri":"https://HOST/apps/connections/callback"}
```

Use the credentials from the approved project and its applicable test/verification configuration. Keep them outside source packages. The Runtime pins the client fingerprint to its registration/epoch; changing it beneath existing custody requires the supported registration/connection workflow. Add neither tokens nor provider credentials to an App manifest or worker.

## Private Runtime configuration

Run on a POSIX local filesystem as one service UID. Operator JSON files must be owned by that UID, mode0600, regular files with one link and no symlink. Create the durable state root with private mode0700. Retain the same store, key ID and encryption key when restarting; never run two writers against one custody.

The following is a template, not an enrollment packet. Replace every placeholder with a value from the current reviewed installation; generate fresh secret material rather than reusing example strings. A single `registration` may be replaced with `registrations` containing the exact distinct reviewed entries for both accounts.

```json
{
  "listen_port": 4082,
  "store_root": "/var/lib/deft-email/state",
  "key_id": "email-custody-v1",
  "encryption_key_hex": "REPLACE_WITH_64_HEX_CHARACTERS",
  "runtime_auth_token": "REPLACE_WITH_DIRECTIONAL_RUNTIME_SECRET",
  "authority_token": "REPLACE_WITH_DISTINCT_AUTHORITY_SECRET",
  "authority_url": "https://HOST/api/app-connection-sessions/runtime/authority",
  "authority_v2_url": "https://HOST/api/app-connection-sessions/runtime/authority-v2",
  "data_authority_url": "https://HOST/api/app-data/runtime/authority",
  "registration": {
    "org_id": "ORG_UUID",
    "runtime_registration_id": "REGISTRATION_UUID",
    "operator_user_id": "OPERATOR_UUID",
    "runtime_epoch": 1,
    "connection_protocol": "v2",
    "profile_digest": "sha256:REVIEWED_PROFILE_DIGEST",
    "target_key": "REVIEWED_OWNER_TARGET",
    "resource_key": "inbox"
  },
  "gmail_client_file": "/etc/deft-email/google-client.json",
  "runtime_channel_files": ["/etc/deft-email/mail-channel.json"]
}
```

The exact v2 authority endpoint must come from the compatible Host's released contract; verify it during operator enrollment. Additional supported upgrade, continuation and reattach authority URLs may be included only when the corresponding public lifecycle is configured. They must use current reviewed authority, not inferred consent.

Each private action-channel file has the issued credential and its three-field registration:

```json
{
  "channel_url": "https://HOST/api/app-runtime/channel",
  "credential": {"session_id":"ISSUED_SESSION_UUID","session_token":"ISSUED_RUNTIME_ONLY_TOKEN"},
  "registration": {"org_id":"ORG_UUID","runtime_registration_id":"ACTION_REGISTRATION_UUID","runtime_epoch":1},
  "technical_renewal": {"expires_at":"ISSUED_CURRENT_EXPIRY","renewable_until":"ISSUED_IMMUTABLE_CEILING"}
}
```

`technical_renewal` is optional and must reflect an explicitly opted-in public issuance. Without it, legacy channels never renew. The example above uses a finite immutable `renewable_until` ceiling and omits `renewal_lifetime`. If the Host explicitly issues technical permission with `renewal_lifetime: "until_revoked"`, preserve that exact alternative metadata:

```json
{"technical_renewal":{"expires_at":"ISSUED_CURRENT_EXPIRY","renewable_until":null,"renewal_lifetime":"until_revoked"}}
```

`renewable_until: null` alone is invalid and grants nothing. Both forms retain finite leases; `until_revoked` permits rolling leases of at most 15 minutes while the Host rechecks the current named operator, role, App/grant and required owner consent. It does not supply account enrollment, human action consent or exact-message Send approval. Initial issuance still requires current reviewed human authority. Denial, revocation, actual lease expiry or a finite ceiling ending stops new claims; an expired Host session cannot be revived by editing a file.

Enrollment files remain unchanged after renewal, so their `expires_at` is issuance metadata rather than the current Host lease. After restart the Runtime reconciles the same opted-in session and lifetime with Host before admitting claims. Record current Host authority separately. See [Runtime renewal contract](../runtime/runtime-channel-renewal.md).

For a new foreground-only preview, omit `resource_sync_channel_files`, `record_mirror_channel_url` and `local_job_channel_url`. Those optional background consumers are independent of the foreground data/Send path. For an existing installation, defer background work through supported Host lifecycle controls first and preserve the operator configuration/history for recovery; this template does not authorize dropping its state or cursor.

Expose `POST /v1/connections` and `POST /v1/data` through reviewed HTTPS routing to the Runtime's loopback listener. Keep authorization bodies, query strings and secrets out of proxy logs; do not add a direct Send endpoint. The Runtime polls the enrolled public action channel and consumes only reviewed released claims.

Start with `EMAIL_RUNTIME_CONFIG_FILE=/etc/deft-email/runtime.json node runtime/server.mjs`. Then connect each account through Email's ordinary UI, inspect account/From labels, and perform [the smoke journey](smoke.md). Record session/consent/renewal deadlines. Re-enroll through supported public flows when authority expires; do not silently edit credential files to simulate continuity.

## Account selection and human access

The inbox account pills filter the messages being read. They do not change the Host's current account for trusted compose, saved drafts and From identity. To compose from another connected account, use **Email settings → Accounts → Use account**, then reopen Email in that account context. A disabled Compose while another read filter is selected is not evidence that Send consent is missing. Check the current account before requesting more access.

Opening Email creates a human Experience session. The normal UI acquires the current private-access exposure and, when necessary, presents its exact review before accepting it. This is separate from Runtime enrollment, account Read consent and human action consent. An API-only client must use `POST /api/app-experiences/sessions/SESSION_ID/access/acquire` with `{}` before a reviewed record action; if it returns `review_required`, use the supported `/access/review` and `/access/accept` workflow with its unmodified current token/digest and `accept_exposure: true`. Reuse existing equivalent consent when offered; never turn an access error into expanded permissions automatically. Draft writes alone do not prove that a session can prepare or submit Send.

## Verify the installation

Record the exact clean checkout, Host image/source, App/package/experience digests, fresh workspace and current reviewed registration pins. Require: public upload/stage/review/activate; no native Email adapter configured; ordinary account connection; one-click Refresh finds new controlled mail; save/reopen a draft; attach/remove a file; review/confirm Send with independent receipt; open a Task's Email source backlink; restart the sole Runtime with the same private store/key and reopen the draft. Keep private credentials and mailbox evidence outside release artifacts.

Use separate controlled provider accounts for this rehearsal, or a supported serial handover of the approved accounts with one writer. Empty imported history on a fresh Runtime is expected; do not manufacture native history rows. Knowledge capture, notifications, provider draft sync and local jobs do not need enrollment for the foreground read/draft/Send proof. Source-to-Task needs a separately reviewed scalar observation and v3 sync publication lane: foreground reads do not produce the signed projections used for source review. Configure that lane below before the Task/backlink gate. Do not promise continuous recovery from a short operator lease.

## Task and Knowledge integration

Use the [connected App author guide from the supported Host release](https://github.com/Maneek21/Deft/blob/v0.3.0-preview.123/docs/connected-app-author-guide.md), also included in its corresponding source. The manifest identifies the exact Host commit if consulting source before tag publication. In that guide, follow **Email source-to-Task readiness** with this installation's current IDs:

1. Review and activate scalar observation under the current owner resource binding. It is separate from foreground Read and does not grant provider actions, attachment transfer or Knowledge destination access.
2. Issue the current v3 sync session and install its private `resource_sync_channel_files` entry using the public `/api/app-resource-sync-channel/v3` and observation-authority endpoints. Preserve its issued technical renewal metadata and finite lease, plus publication consent's separately reviewed finite deadline or explicit `until_revoked` lifetime; an action-channel credential is not a sync credential.
3. Enable the Host's resource-sync scheduler for this reviewed lane (`DEFT_APP_RESOURCE_SYNC_SCHEDULER_ENABLED=true`), then verify a succeeded committed checkpoint and current signed source projections. Do not copy old projections, reset cursors or replay failed/unknown Runs.
4. From the message's top **More** menu, create a Task using the native project/owner/details review. Open the Task and follow its original Email source link under the same current access.
5. For Knowledge, use the message's Knowledge nomination/settings flow to review the intended capture destination and policy. Once configured, capture follows that policy and governed source publication; opening an Inbox or granting draft storage does not provision automatic capture. Confirm the resulting Knowledge item and source return before describing capture as active.

Publication is separate reviewed authority. The finite observation/session example remains valid. Where the Host policy supports and explicitly issues it, publication consent may instead use `consent_lifetime: "until_revoked"` with `expires_at: null`. Technical `until_revoked` renewal alone neither grants nor extends that consent. Operator sessions still use finite leases and revalidate the current named human, role, App/grant and connection pins, and required consent. Each Run has finite input/result retention deadlines; these are not a fixed lifetime for the entire publication lane.

Settle work and revoke a temporary rehearsal observation/session through supported controls when finished, while preserving mailbox access and records. A sustained deployment needs its supported lifecycle configured. See [permission boundaries](author-independence.md#permission-and-action-boundaries), [limitations](limitations.md) and the [bounded acceptance journey](smoke.md).
