# Runtime 0.3.1-e3.5 candidate

This local candidate consumes the exact public Kit alpha.16 archive. Earlier
runtime .4 and all published source/image artifacts remain immutable. No live
provider, deployment or completed Send is part of its local proof.

The data port supports `prepare_resource_action` and
`read_prepared_resource_action` for the `drafts` store and current admitted
mail resource. The independently consented `organize_messages` purpose maps to
Gmail Modify. Read or Send consent never grants Organize. Credential anchors
identify the app-owned ciphertext only; fresh owner action authority and the
released exact Run remain mandatory.

Preparation reads current provider prestate and persists an immutable plan for
1â€“25 owned resource UUIDs. Supported operation keys are `archive`, `trash`,
`mark_read`, `mark_unread`, `star`, and `unstar`. It performs no provider write.
No destination/options, permanent deletion or Undo is exposed in this slice.
The plan expires within five minutes and current resource/action consent.

The public prepared object matches Kit16 exactly. Its six small input pins are
`snapshot_id`, `account_ref`, `operation_key`, `source_manifest_digest`,
`item_count`, and `plan_digest`; the latter equals `snapshot_digest`. The host
adds its seven current connection/data-consent pins. Full ordered source refs,
native provider prestate, preview and purpose/custody generation stay in the
app-owned encrypted snapshot, never in a scalar Run input or author Worker.

Only the public App Runtime claim/start/authorize/result channel can dispatch.
The existing `runtime_channel_files` configuration remains unchanged. One
consumer selects the exact released `send_message` or `organize_messages`
operation. Unknown names have no fallback. The runtime validates all 13 pins,
current owner/install/version/grant/action binding, actual OAuth scope,
connection, client fingerprint, source digests and custody generation. Provider
requests and token refresh retain fresh online authority and expiry/abort fences.

The whole plan is durably reserved before dispatch, and the unchanged native
triage journal records each started item before its effect. A started/unknown
plan never resumes provider reads or remaining effects after restart. An
uncertain item stops subsequent effects and leaves an account effect fence for
reattachment/upgrade. Known failures settle with honest bounded counts.

Returned output has seven flat scalar fields: `operation_id`, `operation_key`,
`item_count`, `succeeded_count`, `failed_count`, `items_json`, and
`automatic_retry:false`. `items_json` is at most 2048 UTF-8 bytes and contains
only the ordered unique source UUIDs and closed succeeded/failed states.
Provider IDs, addresses and arbitrary error strings are excluded.

Durable foreground-cache invalidation occurs before the first possible effect,
including partial/uncertain batches. It changes no provider checkpoint or
freshness/coverage assertion and leaves saved drafts, original MIME and prior
Send snapshots unchanged.

Observation retains its existing 30-second operation ceiling, max25 provider
page and exact public v3 contract. Pure nested checks are request-local within
the held session; entry, every actual provider/token request, checkpoint and
disclosure remain freshly authorized. Safe failure events contain only Run UUID,
static phase/code, elapsed time and authority/provider call counts. Arbitrary
exceptions, body bytes, OAuth state and credentials are never logged. Original
unknown Runs are never replayed; the host may release a separately authorized
new read-only recovery Run under its existing checkpoint/recovery contract.

Synthetic authority-latency results establish a request-count reduction, not
the cause of the earlier live13-second observation failure or a live performance
claim. Actual host/Hono/PG/independent-runtime composition is a separate release
gate. The frozen 51 vendor files are byte-exact against the .4 owned-source
manifest, including its inherited audited token diagnostics.

Local release evidence: the original consolidated suites passed123/123 on each platform. After the narrower Organize callback reduction,26/26 affected tests passed on Windows and POSIX. Synthetic25 execution used58 online authorizations and50 provider requests. The actual public Hono/PostgreSQL/independent-runtime bulk fixture passed25 archive effects, a known partial rejection, and pre-dispatch revocation without replay. Its25-item full SDK flow took31.491seconds including claim/start/result under the unchanged30-second execute ceiling; authority roundtrips left limited headroom. This establishes synthetic composition, not actual Gmail25-item latency or a live performance guarantee.
