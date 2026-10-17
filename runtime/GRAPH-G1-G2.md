# Isolated Graph G1/G2 candidate

This is an offline candidate derived from immutable runtime 0.3.1-e3.5. It has no live Microsoft acceptance or deployment claim. Existing Gmail deployments keep their exact `gmail_client_file` configuration and default provider. Public v1/v2 connection, reviewed upgrade/reattachment, app-data and released Run contracts are unchanged.

One provider serves each operator runtime process. Microsoft requires the following operator-only configuration instead of `gmail_client_file`:

```json
{"provider_config":{"provider":"microsoft","client_file":"/operator/microsoft-client.json","profile_digests":["sha256:<exact reviewed profile digest>"]}}
```

The private Microsoft client file is the frozen OAuth engine's closed `{client_id,client_secret,redirect_uri,tenant}` shape. Tenant is `common`, `organizations`, `consumers` or an explicit tenant UUID. The reader preserves existing private regular-file, owner, mode, size and no-symlink guards. Configurations containing both client selectors are rejected. Every explicitly registered profile digest must be in the deployment allowlist. A public request cannot select a provider, secret, tenant or endpoint. Client/provider identity is sealed in the existing durable registration and custody fingerprint. Host admission must separately review a Microsoft profile and authorization origin; do not reuse a Gmail profile digest or claim readiness from this candidate alone.

The provider selection reaches frozen Microsoft OAuth, query/page/source/presentation/conversation, Send and triage adapters. V2 `send_message` and `organize_messages` remain independently consented purposes; provider-granted Mail.ReadWrite does not authorize Send. Stable-account upgrade verifies the same provider principal/client and increments custody generation while preserving account UUID, cached source UUIDs, draft origin, files and historical receipts. Reattachment has the same provider/client equality guard.

Organize uses frozen ETag/If-Match native triage with at most 25 sources and six reviewed operations: archive, trash, mark_read, mark_unread, star and unstar. Plan creation performs provider reads but no effects. Whole-plan/per-item durable journals and current authority checks remain in force. Known failures produce exact partial receipts; uncertain effects fence the remaining items and are never replayed automatically.

Small Graph Send builds an immutable MIME packet locally, then dispatches the frozen `sendMail` path exactly once after normal reviewed Run release. HTTP202 has no provider message ID; acceptance does not prove Sent-copy reconciliation. MIME above 3MiB is explicitly rejected during local preparation with `EMAIL_NATIVE_SEND_PROVIDER_SIZE_UNSUPPORTED`, before provider drafts/uploads or Send. G3 needs a separately reviewed journalled provider-draft/upload stage and is not implemented here.

Source/file/image reads reuse owned immutable source locators. Source bytes and decoded PDF/CID bytes retain their hashes. Remote images require explicit current policy and public DNS/network checks. Unsupported Graph query terms remain typed unsupported; `in:archive` is currently unsupported by the frozen Graph query compiler even though explicit archive triage and complete folder refresh exist. This limitation is not presented as an empty successful search.

Validation uses synthetic providers only. Separate HTTP process tests use explicit test-only loopback/Windows fixture switches; production configuration exposes no such switches. No provider credentials, browser state, host-private imports, database writes or live network calls are used.
