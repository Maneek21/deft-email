# Technical Runtime channel renewal and reacquisition

The current Email28 Runtime renews short technical sessions and can obtain fresh sessions after an outage that outlasts them. Scoped service reacquisition requires the configured operator's own active until-revoked account grant; it cannot recover another owner's account. Initial setup and permission review remain required. See [connect-once setup](../docs/setup.md#connect-once-operation) and [unattended recovery](UNATTENDED-RECOVERY.md).

The current background-refresh review defaults to **Until revoked**. This is a reviewed permission lifetime, not an endless bearer token. An owner may choose **Until date** instead; that permission stops at its date and does not auto-renew. Technical renewal or fresh service sessions cannot extend it. Revoked authority remains revoked.

The operator-owned channel file keeps its issued `channel_url`, exact two-field `credential` and `registration`. For a finite immutable technical renewal ceiling, its optional metadata has this form:

```json
{"technical_renewal":{"expires_at":"2026-10-11T00:15:00.000Z","renewable_until":"2026-10-11T01:00:00.000Z"}}
```

For explicitly Host-issued `until_revoked` technical renewal, preserve this alternative form:

```json
{"technical_renewal":{"expires_at":"2026-10-11T00:15:00.000Z","renewable_until":null,"renewal_lifetime":"until_revoked"}}
```

Use the exact issued metadata, not these example timestamps. The finite form omits `renewal_lifetime`; null alone is rejected. The `until_revoked` form requires that explicit lifetime and `renewable_until: null`, with a finite `expires_at`. Its initial lease and accepted renewal replies cannot exceed 15 minutes ahead. The Host rechecks current named-human membership/role, App/grant and required owner consent; the original reviewing browser session's expiry does not itself end this explicitly issued technical permission. Initial issuance still requires live reviewed human authority. This supplies neither account enrollment nor human action consent, exact-message approval or [separate reviewed publication authority](../docs/setup.md#task-and-knowledge-integration). Publication consent may be finite or explicitly `until_revoked` where the Host supports and issues it; technical renewal alone neither grants nor extends it. Each Run still has finite input/result retention deadlines rather than setting a fixed lifetime for the entire publication lane.

The Runtime holds no human browser credential and does not issue or activate sessions. Legacy files without `technical_renewal` use the original client unchanged and never renew; this includes E2 and the expired first App5 channel.

One background task per opted-in channel begins renewal about 5–6 minutes before the lease ends, through the public Kit client using the same session and bearer. Renewal does not alter a Run, attempt, epoch, prepared payload or provider effect. New claims stop while renewal is pending or uncertain, with less than 30 seconds of known channel life, or after definitive denial. Only an exact successful Host acknowledgement restores claims. Existing attempt methods retain their original authority checks and heartbeat limits.

Transport uncertainty permits at most three renewal requests per burst with the same expected expiry. The background task then backs off for 5, 10, 20 and at most 30 seconds between bursts, clipped to the known lease deadline. It never uses the old lease as authority while uncertain. Actual expiry, denied or malformed authority replies and shutdown remain closed; no provider operation retries are introduced. The `state` getter distinguishes live, renewing, reconciling, unavailable, denied, expired and closed.

Enrollment files remain unchanged after renewal. On restart, an elapsed file timestamp is an old issuance expectation rather than proof that the Host session expired. Claims remain blocked while startup reconciliation asks the Host for the same opted-in session, original renewal lifetime and finite ceiling when present. Transient startup reconciliation has a 90-second budget, clipped to a finite ceiling when present. Only a future exact-identity Host reply with the same lifetime/ceiling permits that old channel to resume. It cannot revive an expired or revoked Host session.

If the installed short session has actually expired, or renewal reports terminal stale-session authority, the separate service supervisor asks the Host for fresh sessions for the exact current registration. It uses the existing service credential and current until-revoked permission, with owner equal to the configured operator. The old browser and old session row are not required. Temporary failures retry with jittered backoff capped at five minutes; a permanent service/permission denial emits `reconnect_required`. The supported owner/operator flow must address that cause.

Fresh sessions use the authenticated installer and are persisted encrypted. Lost acknowledgements reconcile against its durable journal, and superseded workers stop. Trusted compatible upgrades can enroll a receipt-backed successor registration without operator-file edits. Changed authority still needs review. Neither renewal nor reacquisition retries Send, provider effects or an uncertain original Run.

Shutdown aborts in-flight renewal and its wait. Operator files, credential bytes, encrypted state and old channel histories are not rewritten by the renewal task. Duplicate opted-in session enrollment is rejected rather than creating competing renewal workers.

Structured `email_runtime_channel_renewal` diagnostics contain only a closed phase/reason, attempt number, bounded remaining milliseconds and a UUID session identifier when valid. They never include URLs, credentials, exception messages, request/reply contents or mailbox data. A failed diagnostic sink cannot change authority or renewal behavior. Observer Run phase diagnostics remain separate: a renewed channel does not imply a successful Run or publication.

Focused fixtures cover expiry, prolonged outages, restart reconciliation, lost acknowledgements, finite consent expiry, revocation, changed authority and shutdown. These use synthetic transport rather than live provider delivery. The separately recorded 21 October live outage check proved scoped service reacquisition after all four old sessions expired; [verification](../docs/verification.md) records its exact scope. Check current Host sessions, sync checkpoints and structured recovery state as well as HTTP health. A renewed channel alone does not prove successful sync/publication.
