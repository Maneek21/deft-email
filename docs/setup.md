# Foreground preview setup

Use the exact compatible candidate in [compatibility](compatibility.md). This is the intended public installation sequence, not a completed installation claim. The last schema 117 activation rejected the supplemental-effect field; stop before activation until a corrected Host and its exact schema/image pins have been verified. Files under `runtime/` retain historical implementation notes; their e3.x/Kit16 version descriptions are not the current installation recipe.

## Start an isolated compatible Deft

Use published deployment assets for the exact prebuilt Host named in the final compatibility record. The author builds Email outside Deft; a Host source checkout is needed only if the operator chooses to rebuild the Host. These commands are for a fresh POSIX Docker installation in the deployment-assets directory. Keep its project name, database, uploads volume and secrets separate from every existing workspace:

The current Host allows initial organization signup only while its database has no organization. Inviting another user into an existing organization does not create a fresh workspace. Uploading `io.deft.email` into an organization that already installed it follows the upgrade path, so it cannot prove a fresh installation. Use a separate fresh database and Runtime custody for the new-developer rehearsal.

A separate physical server or new DNS name is not required. An operator may serially route an existing approved HTTPS origin to the isolated Host, using the same allowlisted OAuth callback/client, while the original Host and its Runtime have no active work. Keep the original database, configuration and custody intact, route only one Host at a time, and restore the original routing afterwards. Keep the isolated Compose network private; if attaching a proxy network, use unique Host/database service names and explicit upstreams so service aliases cannot collide with the original deployment. Record that this is a fresh database and installation on shared infrastructure; do not claim a second workspace in the original database or concurrent account writers.

```sh
cp .env.example .env
mkdir -p private
chmod 700 private
```

Fill `.env` with fresh `POSTGRES_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET` and `ENCRYPTION_KEY`, and set `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` to the browser-reachable rehearsal URLs. Use the Host's `docs/self-hosting.md` and `docs/self-hosting-vps-domain-https.md` for HTTPS routing. Runtime callbacks and authority URLs require HTTPS; a plain localhost health check is not a connection proof.

Set `DEFT_RELEASE_VERSION` to the schema value specified by the verified compatible Host artifact; do not copy image/release metadata or the historical schema 117 value. Set these preview gates in the operator environment. A prebuilt browser bundle must already contain the matching `NEXT_PUBLIC_*` gates and public origin; runtime variables cannot enable a gate omitted from that build:

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
  postgres:
    image: pgvector/pgvector@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b
  deft:
    volumes:
      - ./private:/run/deft-email:ro
```

The PostgreSQL pin above belongs to the historical clean schema rehearsal (PostgreSQL 160015 / vector 0.8.6). Use it only if the selected Host's published fresh-schema contract requires that same tuple; otherwise use that artifact's tested immutable database pin. Historical image metadata preview16 and schema117 were distinct identities. Record the selected image and schema separately and require `/health/ready` to report its expected schema. None of these settings authorize initializing or downgrading an existing database. A directory bind lets the operator atomically replace the registry file without exposing a truncated file to the Host.

Use the selected published recipe to load or pull its exact prebuilt image for `deft`, `init`, `doctor` and `smoke` before these commands; do not silently fall back to a local build. If rebuilding from corresponding source is intentional, run its documented build first. Then use the supported fresh-database init, which asserts freshness, runs `db:push-full`, and applies the production-safe seed. It does not seed demo users or native Email accounts:

```sh
docker compose -p email-preview-isolated -f docker-compose.yml -f compose.email-preview.yml up -d postgres
docker compose -p email-preview-isolated -f docker-compose.yml -f compose.email-preview.yml run --rm init
docker compose -p email-preview-isolated -f docker-compose.yml -f compose.email-preview.yml up -d deft
docker compose -p email-preview-isolated -f docker-compose.yml -f compose.email-preview.yml run --rm doctor
docker compose -p email-preview-isolated -f docker-compose.yml -f compose.email-preview.yml run --rm smoke
```

Sign up normally at the rehearsal Host; its first human signup becomes owner. Do not use `db:seed:demo`, restore a demo database, or configure `DEFT_APP_CONNECTION_ADAPTERS_CONFIG`. This Email App uses the external HTTP connection registry below; it does not need a native Email adapter, native account, or copied mailbox/custody rows.

## Register and sideload

1. Build `app/app.deft.json` and retain its package/experience digests from `app/build-result.json`.
2. Open **Settings → Apps**, upload `app/app.deft.json`, inspect it, then stage it for explicit authority review. The App ID is `io.deft.email`; source code is not uploaded as executable Host code. This package is protocol 7: the UI stages through `POST /api/apps/blob/composition/stage`, reads `GET /api/apps/blob/composition/INSTALLATION_ID/context?app_version_id=VERSION_ID`, then uses `/review` and `/activate` under that same composition path. Use the exact current review request/digest supplied by Host. Staging grants no account access or action consent.
3. Do not substitute `/api/apps/stage`, `/api/app-runtime-review`, or the older `deft app install-local` tutorial for this protocol 7 path. The Kit CLI rebuilds a `deft.app.json` authoring project; this repository instead uses its custom `app/build.mjs` to produce the upload package.
4. After activation, obtain the new installation/version/package/grant pins from the Apps UI or its authenticated public context. Read `GET /api/apps/INSTALLATION_ID` for `{app: ...}` and its `active_grant_snapshot_id`, current version and lifecycle pins. `GET /api/apps/INSTALLATION_ID/grants` returns `{grants: {installation, versions, snapshots, ...}}`; read `grants.installation` and select `grants.snapshots` by its active snapshot ID. Do not read `installation` at the response top level. The protocol 7 Runtime setup context also returns the current grant digest/operator pins. Configure the external HTTP registry as below, then perform administrative admission and owner resource review. Bind only the IDs issued for this installation.
5. Enroll separate Read/data authority, human action consent and Send/Organize channel sessions through their public workflows. Runtime health or an admin declaration cannot grant a human action. Use explicit finite expiries and the issued immutable renewal ceiling.

The final clean sideload rehearsal must exercise this sequence on an isolated compatible installation. A database row copied from the demo or a native Email route is not this workflow. Exact UI labels may change with the compatible Host build.

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

`technical_renewal` is optional and must reflect an explicitly opted-in public issuance. Without it, legacy channels never renew. With it, the same session renews within the original ceiling; after denial, revocation or ceiling expiry, new claims stop. After restart the Runtime reconciles that same session with Host before admitting claims. See [Runtime renewal contract](../runtime/runtime-channel-renewal.md).

For a new foreground-only preview, omit `resource_sync_channel_files`, `record_mirror_channel_url` and `local_job_channel_url`. Those optional background consumers are independent of the foreground data/Send path. For an existing installation, defer background work through supported Host lifecycle controls first and preserve the operator configuration/history for recovery; this template does not authorize dropping its state or cursor.

Expose `POST /v1/connections` and `POST /v1/data` through reviewed HTTPS routing to the Runtime's loopback listener. Keep authorization bodies, query strings and secrets out of proxy logs; do not add a direct Send endpoint. The Runtime polls the enrolled public action channel and consumes only reviewed released claims.

Start with `EMAIL_RUNTIME_CONFIG_FILE=/etc/deft-email/runtime.json node runtime/server.mjs`. Then connect each account through Email's ordinary UI, inspect account/From labels, and perform [the smoke journey](smoke.md). Record session/consent/renewal deadlines. Re-enroll through supported public flows when authority expires; do not silently edit credential files to simulate continuity.

## Account selection and human access

The inbox account pills filter the messages being read. They do not change the Host's current account for trusted compose, saved drafts and From identity. To compose from another connected account, use **Email settings → Accounts → Use account**, then reopen Email in that account context. A disabled Compose while another read filter is selected is not evidence that Send consent is missing. Check the current account before requesting more access.

Opening Email creates a human Experience session. The normal UI acquires the current private-access exposure and, when necessary, presents its exact review before accepting it. This is separate from Runtime enrollment, account Read consent and human action consent. An API-only client must use `POST /api/app-experiences/sessions/SESSION_ID/access/acquire` with `{}` before a reviewed record action; if it returns `review_required`, use the supported `/access/review` and `/access/accept` workflow with its unmodified current token/digest and `accept_exposure: true`. Reuse existing equivalent consent when offered; never turn an access error into expanded permissions automatically. Draft writes alone do not prove that a session can prepare or submit Send.

## Rehearsal acceptance

Record the exact clean checkout, Host image/source, App/package/experience digests, fresh workspace and current reviewed registration pins. Require: public upload/stage/review/activate; no native Email adapter configured; ordinary account connection; one-click Refresh finds new controlled mail; save/reopen a draft; attach/remove a file; review/confirm Send with independent receipt; open a Task's Email source backlink; restart the sole Runtime with the same private store/key and reopen the draft. Keep private credentials and mailbox evidence outside release artifacts.

Use separate controlled provider accounts for this rehearsal, or a supported serial handover of the approved accounts with one writer. Empty imported history on a fresh Runtime is expected; do not manufacture native history rows. Knowledge capture, notifications, provider draft sync and local jobs do not need enrollment for the foreground read/draft/Send proof. Source-to-Task needs a separately reviewed finite scalar observation and v3 sync publication lane: foreground reads do not produce the signed projections used for source review. Follow the [author guide](https://github.com/Maneek21/Deft/pull/355) before the Task/backlink gate; disable/revoke that temporary lane after settled work. Do not promise continuous recovery from a short operator lease.
