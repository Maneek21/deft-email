# Verification and acceptance

Use [the shipped Email28 compatibility record](https://github.com/Maneek21/deft-email/releases/download/v1.9.0-preview.28/compatibility.json) for its exact source, artifacts, checksums and publication state. Current source prepares Email29 with a merged Reply opening fix; release/deployment is held for coordinated Host137 acceptance. The Email28 observations below do not verify that later fix on a deployed release. A prepared candidate is not published merely because its files build. Each final public prerelease must link its acceptance results and disclose unverified behavior.

## Connect-once observations, 21–22 October 2026

The 21 October run on Host `0.3.0-preview.133`, Email26 / App `1.9.1-preview.7` / Runtime `0.4.0-preview.24` passed a trusted upgrade, Host restart, Runtime restart and about 21 minutes of Runtime downtime. All four previous short sessions expired during the outage; scoped Runtime service authority issued four fresh until-revoked sessions automatically. Operator configuration stayed unchanged, no new owner permission/recovery step was needed, and no Send occurred. This tested the configured operator's own account. Optional maintenance controls were still visible in that older UI.

The 22 October run on Host `0.3.0-preview.136`, Email28 / App `1.9.1-preview.9` / Runtime `0.4.0-preview.26` separately passed a second trusted upgrade. Existing background, draft and private Experience approvals carried forward. Four fresh system-issued sessions renewed, automatic catch-up reached complete coverage with all 112 retained messages, and the visible Inbox loaded without review, recovery or reconnect prompts. There were zero owner permission reviews, recovery clicks, reconnects, manual syncs or Sends; operator configuration stayed unchanged.

That second run also recorded a first automatic read whose result timed out on a Host checkpoint lock. The exact lock blocker was unproven. The original read stayed `unknown_outcome`; a later independent automatic read resumed after the configured 15-minute interval, then drained successful catch-up pages. No one replayed, manually retried or closed the uncertain read. This evidence supports automatic continuity, not an instant-recovery guarantee. The separate live smoke still recorded Reply form timeouts; it does not establish a reliable full Reply journey.

These are bounded deployment observations, not a fresh-install or production-scale acceptance claim. They do not extend the older Send evidence. [Known limitations](limitations.md) include the self-healing Knowledge mailbox-generation race, settings API gaps and remaining time-budget limits. Public implementation changes are recorded in [Email #14](https://github.com/Maneek21/deft-email/pull/14), [#16](https://github.com/Maneek21/deft-email/pull/16), [#17](https://github.com/Maneek21/deft-email/pull/17), [#18](https://github.com/Maneek21/deft-email/pull/18), [#19](https://github.com/Maneek21/deft-email/pull/19), [#20](https://github.com/Maneek21/deft-email/pull/20), [#21](https://github.com/Maneek21/deft-email/pull/21) and [#22](https://github.com/Maneek21/deft-email/pull/22).

## Evidence that can be reused

The retained demo acceptance on 18 October 2026 used Host `ca1e6ec243c509e6338355ec9d0775b35426777c`, Email source `39f7287d` (App `1.9.0-preview.13`, Runtime `0.4.0-preview.15`), App Kit38 and Runtime Kit35. The report recorded successful switching and Refresh for two Gmail accounts, HTML external-image rendering, and healthy post-restart Host/Runtime/database operation. It also recorded slow visual Refresh, a parallel 403, a partial-access banner and the deployment-overlap capacity issue. Those remain historical observations; [limitations](limitations.md) describes the current set.

Those observations are exact prior-candidate evidence. They do not establish public release availability, the final merged Host image's browser flags, a clean public install or any changed artifact's behavior. Earlier delivery, attachment, Task, restart and upgrade receipts may be reused only when their artifact/contract scope matches and that reuse is stated explicitly. Host API inspection of a recipient copy, including the prior PDF17S check, is not independent Gmail recipient verification.

## Release acceptance record

For each row in [the bounded journey](smoke.md), record the final Host image/commit/schema, Email package/Runtime identity, whether evidence was reused or freshly observed, and the result. Keep private accounts, credentials, MIME and operational details out of public artifacts. Publish an appropriately redacted outcome summary with release downloads.

Required evidence covers public assets and checksums; Apps in the actual release browser bundle; a standalone clean Email build; Gmail connection/read/HTML/images; attachment draft save/reopen; one reviewed Send and independent recipient verification; Task/source return; restart persistence; Email-only upgrade with unchanged Host; and relevant backend health. Installation, isolation, data-loss and duplicate-send failures remain blockers. Other residuals must be explicit.

## Local source checks

The [README build](../README.md#build-independently), [focused CI](../.github/workflows/ci.yml), Kit pin checks and Runtime provenance establish source/package contracts. They are not live provider tests. The release process uses the actual protected checks on the final integrated commits, including security, rather than substituting earlier green PR heads.

[Historical initial author-independent verification](history/verification-before-public-preview.md) preserves the earlier clean-build and fixture receipts without upgrading their scope. [Historical compatibility](history/compatibility-before-public-preview.md) preserves earlier source offers and artifact pins.
