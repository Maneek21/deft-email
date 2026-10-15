# Independent Email runtime â€” 0.3.1-e3.5 local candidate

This package operates the frozen HTML93 Gmail OAuth/mail/source/MIME engine with independent app-owned encrypted custody, resources, rich drafts/files, immutable prepared Send snapshots and reviewed public App Runtime execution. It never forwards native host Email routes, imports private host code/DB, exports host keys, or exposes a direct Send HTTP endpoint. PROVENANCE.json records byte-exact frozen dependency copies and the separately ported app-owned persistence/compose behavior. Previous E2.1/E2.2 source artifacts stay immutable. Root owns the final App/Kit/host/runtime digest bundle, source offer and deployment acceptance; synthetic tests alone do not establish E2 journey completion.

## Install and operator configuration

Node >=22.13.0, a POSIX local persistent filesystem, one service UID, and exactly one writer are required in production. Install the frozen lock with exact public Kit alpha.16 tarball, nodemailer 10.0.10 and mailparser 3.9.28. No developer junction, host node_modules, generated directory or host-private module is an artifact dependency. Windows is test-only; the production CLI refuses it. Keep all operator secrets outside source/author bundles, mode0600 under the service UID.

Use EMAIL_RUNTIME_CONFIG_FILE=/absolute/private/runtime.json node server.mjs. The server binds loopback only; a reviewed HTTPS reverse proxy exposes POST /v1/connections and, when explicitly configured, POST /v1/data. Disable body/auth/query logging and redirects. No browser credentials or arbitrary provider URL can enter these ports.

For a v2 installation that supports capability upgrades or credential repair, include both `authority_v2_url` and `upgrade_authority_url`, derived from the same reviewed HTTPS Host origin:

```json
{
  "authority_v2_url":"https://HOST/api/app-connection-sessions/runtime/authority-v2",
  "upgrade_authority_url":"https://HOST/api/app-connection-sessions/runtime/upgrade-authority"
}
```

The connection-only example below is legacy v1 and does not enable those engines. A v2 registration alone does not enable repair: omitting `upgrade_authority_url` leaves both upgrade and repair unavailable. Existing-account consent continuation separately requires `consent_continuation_authority_url` at `/api/app-connection-sessions/runtime/consent-continuation-authority`; reattachment separately requires `reattach_authority_url` at `/api/app-connection-sessions/runtime/reattach-authority`. Configure each supported capability explicitly on the reviewed Host origin; no URL or authority fallback is inferred. Preserve the exact registration, directional bearer and custody pins when updating an existing operator configuration. A listening Runtime or successful data read is not proof that these optional capabilities are wired.

Exact connection config:

```json
{
  "listen_port":4082,
  "store_root":"/var/lib/email-runtime/state",
  "key_id":"email-custody-v1",
  "encryption_key_hex":"NEW_64_HEX_CHARACTERS",
  "runtime_auth_token":"NEW_RANDOM_BASE64URL_AT_LEAST_43_CHARACTERS",
  "authority_token":"DIFFERENT_RANDOM_BASE64URL_AT_LEAST_43_CHARACTERS",
  "authority_url":"https://HOST/api/app-connection-sessions/runtime/authority",
  "registration":{"org_id":"ORG_UUID","runtime_registration_id":"REGISTRATION_UUID","operator_user_id":"OPERATOR_UUID","runtime_epoch":1,"profile_digest":"sha256:EXACT_REVIEWED_PROFILE","target_key":"ACTUAL_REVIEWED_OWNER_TARGET_KEY","resource_key":"inbox"},
  "gmail_client_file":"/absolute/private/google-client.json"
}
```

The private Google file is {client_id,client_secret,redirect_uri,verify_aliases?}; the redirect is the host's exact HTTPS /apps/connections/callback. Before first begin, canonical frozen OAuth client fingerprint is durably pinned to org/registration/runtime_epoch/profile. Changing client ID/redirect/alias selection cannot begin fresh sessions under old pins; reviewed new registration/epoch is required. Sessions independently pin it; missing legacy fingerprints retain custody but become indeterminate.

Single registration remains explicitly supported. Replace that one field with registrations:[...1Ã¢â‚¬â€œ32 exact entries...] to serve multiple admitted accounts behind one client/transport/process/store. Unknown or drifted registrations are denied before authority/engine access. Exact session/org/owner/install/version/grant/resource/runtime/operator/profile/account scopes remain separate. Shared endpoint/client never merges account custody.

To enable app-data, add the exact optional field:

```json
{"data_authority_url":"https://HOST/api/app-data/runtime/authority"}
```

To consume reviewed Send claims, also add runtime_channel_files:["/absolute/private/send-channel.json",...] (1Ã¢â‚¬â€œ32 unique paths). Each private channel file is exactly:

```json
{"channel_url":"https://HOST/api/app-runtime/channel","credential":{"session_id":"RUNTIME_SESSION_UUID","session_token":"RUNTIME_ONLY_CHANNEL_TOKEN"},"registration":{"org_id":"ORG_UUID","runtime_registration_id":"ACTION_REGISTRATION_UUID","runtime_epoch":1}}
```

These files are operator enrollment inputs, never author-selectable paths/modules. Polling starts automatically in the process: claim Ã¢â€ â€™ start Ã¢â€ â€™ authorize Ã¢â€ â€™ one fenced dispatch Ã¢â€ â€™ result. In E5.11 the first action claim starts immediately. Empty claims or polling errors back off from500ms to5s; a claimed result resets the delay. The worker never replays a claimed action, retains bounded lease/30s operation deadlines, and aborts on shutdown. Enroll/revoke/rotate channel credentials through the public host Runtime lifecycle; they are not owner bearer tokens. Run node verify-provenance.mjs and the focused npm test script against exact artifact source/dependencies before deployment.

## Authority and conditional OAuth

/v1/connections uses exact public deft.app_connection_runtime.v1 begin/callback/status/disconnect,16KiB request/reply, directional runtime-only bearer and online current host authority before each provider I/O and before disclosure. All exact authority pins repeat; deadlines may only shrink. Timers combine incoming/provider/expiry signals; socket loss aborts while normal request body completion does not. Introspection is5s, requests30s, no redirects.

Default connections request only openid,email,gmail.readonly. A fresh begin/callback may carry the host-derived exact optional action_consent for send_message only after explicit current owner-reviewed Send target/binding consent. Only that validated pending consent adds gmail.send. Manifest action_keys/admin profile review cannot grant Send; a retained Read credential never silently upgrades. Later Send requires a current owner-reviewed released AppRun and current data/account/action authority. Read status remains independent if Send is revoked. Organize/modify scopes remain unavailable.

/v1/data uses exact public deft.app_data_runtime.v1 with full connection/scope and current human data/resource consent pins. The host journals request UUID, canonical sha256({operation,input}), active connection revision/account and human SID before operation. The runtime rechecks public app-data authority at each I/O/disclosure; consent cannot be inferred from stored connection credentials. Explicit owner record-write consent governs mutations. Generic resource reads use admitted resource-content authority; incoming selectors never nominate raw provider IDs/URLs.

## App-owned durable data and resources

All data is under the same non-stealable writer. POSIX UID/private modes, no symlink ancestry/hardlinks/shared storage, authenticated encrypted rows, CAS temporary write/fsync/atomic rename/directory fsync. Linux NFS/SMB/tmpfs/ramfs are refused. Connection/custody AAD remains email.runtime.store.v1; new rows use email.app_data.store.v1 plus scoped key identity/revision/key ID. Keys hash org/owner/account/kind/record identity, never cross-owner/account selectors. Provider tokens also retain frozen encrypted custody rules.

The complete480KiB native JSON draft preserves mode/from/to/cc/bcc/subject/plain/safeHTML/managed-signature/parent/attachment metadata with row/content revisions and content digest.32files and25MiB each+aggregate; immutable owned bytes have exact SHA256 and upload revision. Staged encrypted bytes publish only through draft/catalog CAS; lost response reconciles request UUID/receipt without another mutation. Detached tombstones remain and cannot be reused; inline CID prevents detach until explicitly removed from content. Rich safeHTML must match plaintext and reference owned raster bytes. Active file catalog is separate from opaque native value. Lists return bounded metadata only; full bodies bypass Worker capacity limits through the trusted record control.

Reply/reply_all/forward creation uses one generic source_refs reference to a current scoped UUID/digest and complete empty native defaults. The runtime derives recipients, self exclusion, full original quote and logical parent from the current frozen source reader. Bcc is never derived. Native body/JSON fitting is visible through durable summary.notice if source/quote/subject is incomplete; original files are not silently included. Mode/parent cannot be rebound through save. Exact source digest is retained and rechecked at Send preparation.

Stable app-owned Experience UUIDs map native logical mail identities, separately persisted per account. Refresh drives one real frozen Gmail inventory/catchup/sweep/delta page and advances checkpoint only after scoped rows/tombstones persist; partial pages never infer deletions. Search/thread pages cannot overwrite sync cursor or coverage. Cached lists declare provider_observed:false; observed reads/refresh preserve freshness/completeness. Source/presentation/file/image resolve only current owned locator+digest; EML bytes35MiB, attachments25MiB, received raster2MiB, explicit remote-image permission and frozen SSRF checks. A metadata revision change rejects stale source references. There is no background durable-job scheduler in this candidate; current UI refresh drives bounded continuation.

JSON request512KiB; record value480KiB; JSON result2MiB. File frame is uint32BE header length + exact UTF8 JSON header(max16KiB) + bytes(upload25MiB; source download35MiB). SHA256 strings on generic wire use sha256: prefix; native attachment hashes/HTML image lookup remain rawhex only inside validated native value/renderer mapping. Public result fields are operation-disjoint. request_status reconciles a mutation's durable acknowledgement without replaying it.

## Immutable reviewed Send and recovery

prepare_action is data preparation only: it validates current row/content/files/source/from identity and actual Send capability, builds byte-exact frozen native MIME and stores immutable encrypted snapshot/body/file/MIME bytes. The public generic prepared record action supplies full bounded preview plus10 scalar snapshot/draft/content/source/file/MIME/payload pins; the host merges7 trusted current connection/data pins into reviewed17-field AppRun input. prepare_expires_at is limited by actual consent and5min; no large draft bytes travel through Worker/Run input. read_prepared returns the exact snapshot, never a mutable draft. The released prepared_digest is exactly the public prepared.snapshot_digest, which the runtime verifies against its immutable app-owned identity (scope, connection, consent, input, preview and expiry). It is not a hash of the full prepared response envelope. The public host broker and current authority must agree on this same digest.

One send_message binding handles compose/reply/reply_all/forward; native reply headers/thread and all bytes stay pinned. The runner validates exact started claim/current authorize response, owner/org/install/version/grant/epochs/binding/lease, prepared/input digests, local connected custody/client/account and conditional Send consent. It atomically freezes the exact draft CAS as submitted, then reserves snapshot provider_started before dispatch. Concurrent edits/prepares cannot reuse that draft. Every provider I/O revalidates public current action authority and shrinking lease. Validated provider acceptance is persisted before final disclosure, with app-owned receipt and accepted summary; unknown effect remains submitted/unknown or started. The public reviewed Runtime result is accepted/indeterminate/not_attempted, never a claim of delivery.

Process loss/provider uncertainty/lease expiry never resends a reserved snapshot. Repeated exact Run can return retained acceptance; foreign Run cannot acquire it. Snapshot/request journals and byte custody survive restart. Orphan .writer lease is never automatically stolen: fence all old writers, verify recorded process dead, snapshot full state+key, remove only orphan lease, then start one writer and reconcile. Preserve unknown rows/tombstones/custody; no implicit reconnect, key export, ciphertext adoption or automatic effect repair.

## Evidence boundaries and remaining work

Runtime focused tests use synthetic provider responses and real native MIME/parser/provider adapters. Root's public HTTP/DB/process integration separately verifies actual host authority and transport. Current VALIDATION.json records fresh commands/counts/hashes; older connection-only counts are not full native evidence. No live Connect/Send/recipient/browser claim is made here. Existing copied WIP app request-capacity baseline7failures remain outside runtime tests.

E5 retained native account/message/draft/file adoption and historical ciphertext/key lineage remain separate gates. Graph/IMAP/SMTP, Organize/triage/provider draft sync, provider-wide revoke, durable scheduled jobs, explicit unknown-effect repair and broader parity are not exposed by this Gmail runtime. Host native mounts/schema/repair jobs cannot be removed solely because this candidate exists. Root must finish exact package/install/host/UI/controlled journey acceptance before declaring E2 complete.

Runtime 0.3.1-e2.5 batches app-owned mailbox cache writes and projects the committed page directly. Fresh online authority runs before batch entry, before advancing the checkpoint, and before returned rows; each row retains local scope, deadline and abort checks. Every provider fetch still uses current online authority. No settled authority decision is cached, no connection-session parallelism changes, and revoked or expired batches cannot disclose rows or advance their checkpoint. This repair addresses measured 25-message list authority amplification; it does not classify every source/image failure as latency.

## E3 source candidate: one MIME read per binary

Unpackaged E3 source changes retain all connection-session and mutation locks. Verified sender identities load only for responses needing them; cache-only reads still validate current custody health. Each received file/image extraction uses one current native source read, validates exact bytes and digest-derived part references, and retains explicit remote-image permission, frozen DNS/redirect/raster guards, fresh online network/disclosure checks and byte clearing on denial. The 51 frozen vendor copies remain unchanged. Focused Windows/POSIX evidence is e3-read-slice-proof.json; this is not a new deployed artifact or a claim that session head-of-line blocking is eliminated.

E3 reviewed reattachment is documented in E3-REATTACHMENT.md. Configure optional reattach_authority_url explicitly; no OAuth authority fallback exists. This is an unbuilt, undeployed candidate until separately packaged and accepted. Published E2.5 artifacts remain immutable.

## Foreground reads in e3.3

See E3-FOREGROUND-CACHE.md. Data-only process-local memoization may reuse exact observed query pages/presentations for at most60 seconds, after fresh current host/custody/scope checks. Explicit Refresh invalidates the account memo before provider work; background mailbox/checkpoint changes invalidate through durable generations. No settled authority decision, binary bytes or provider credentials enter the memo. Provider/token network reads and final disclosure remain freshly authorized. This does not configure background observation or claim measured live latency improvement.

See E3-CAPABILITY-UPGRADE.md for explicit v2 protocol, independent purposes, stable-account OAuth upgrade and original attachment copy. This local candidate does not yet execute Organize.

Current .5 local candidate adds immutable bounded Organize preparation and released execution, independent owner Organize/Modify consent, whole-plan/per-item no-replay journals, and safe observation diagnostics. Existing v1 Read/Send remains supported; E3-ORGANIZE.md defines the limits and exact scalar pins. All 51 frozen vendor copies are unchanged. No live deployment or actual observation-failure diagnosis is asserted by this local package.
