# Technical Runtime channel renewal

An operator can explicitly opt in at fresh public session issuance. The resulting operator-owned channel file keeps its existing `channel_url`, exact two-field `credential` and `registration`, with this optional metadata:

```json
{"technical_renewal":{"expires_at":"2026-10-11T00:15:00.000Z","renewable_until":"2026-10-11T01:00:00.000Z"}}
```

Use the exact issued expiry and immutable ceiling, not these example timestamps. The Runtime holds no human browser credential and does not issue or activate sessions. Legacy files without this field use the original client unchanged and never renew; this includes E2 and the expired first App5 channel.

One background task per opted-in channel renews at a 90-second margin through the public Kit client using the same session and bearer. Renewal does not alter a Run, attempt, epoch, prepared payload or provider effect. New claims stop while renewal is pending or uncertain, with less than 30 seconds of known channel life, or after definitive denial. Only an exact successful Host acknowledgement restores claims. Existing attempt methods retain their original authority checks and heartbeat limits.

Transport uncertainty permits at most three renewal requests per burst with the same expected expiry. The background task then backs off for 5, 10, 20 and at most 30 seconds between bursts, clipped to the known lease deadline. It never uses the old lease as authority while uncertain. Actual expiry, denied or malformed authority replies and shutdown remain closed; no provider operation retries are introduced. The `state` getter distinguishes live, renewing, reconciling, unavailable, denied, expired and closed.

Enrollment files remain unchanged after renewal. On restart, an elapsed file timestamp is an old expectation rather than proof that the Host session expired. Claims remain blocked while startup reconciliation asks the Host for the same opted-in session under its original ceiling. Transient failures may retry for at most 90 seconds from construction, clipped to that ceiling. Only a future exact-identity Host reply permits claims. An expired/revoked Host session, definitive denial or exhausted startup budget leaves the channel closed, with unrelated Runtime reads still available. This never renews legacy files or resurrects expired Host authority.

Shutdown aborts in-flight renewal and its wait. Operator files, credential bytes, encrypted state and old channel histories are not rewritten by the renewal task. Duplicate opted-in session enrollment is rejected rather than creating competing renewal workers.

Structured `email_runtime_channel_renewal` diagnostics contain only a closed phase/reason, attempt number, bounded remaining milliseconds and a UUID session identifier when valid. They never include URLs, credentials, exception messages, request/reply contents or mailbox data. A failed diagnostic sink cannot change authority or renewal behavior. Observer Run phase diagnostics remain separate: a renewed channel does not imply a successful Run or publication.

Focused fixtures cover the original expiry crossing, active attempt identity, lost acknowledgement, concurrent renewal, claim margin, unchanged old files, revocation/changed ceiling, late acknowledgement, bounded retries and shutdown. The actual server fixture closes and reopens its encrypted store using the unchanged enrollment file, then verifies current-Host recovery and expired-Host dormancy. All fixtures use synthetic transport with zero provider calls. Production Host authority/SQL and installed deployment acceptance are separate gates.
