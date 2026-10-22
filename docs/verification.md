# Verification and acceptance

Use [the authoritative compatibility record](https://github.com/Maneek21/deft-email/releases/download/v1.9.0-preview.28/compatibility.json) for the exact release source, artifacts, checksums and publication state. A prepared candidate is not published merely because its files build. The final public prerelease must link its acceptance results and disclose unverified behavior.

## Evidence that can be reused

The retained demo acceptance on 18 October 2026 used Host `ca1e6ec243c509e6338355ec9d0775b35426777c`, Email source `39f7287d` (App `1.9.0-preview.13`, Runtime `0.4.0-preview.15`), App Kit38 and Runtime Kit35. The report recorded successful switching and Refresh for two Gmail accounts, HTML external-image rendering, and healthy post-restart Host/Runtime/database operation. It also recorded the slow visual Refresh, parallel 403, partial-access banner and deployment-overlap capacity issue listed in [limitations](limitations.md).

Those observations are exact prior-candidate evidence. They do not establish public release availability, the final merged Host image's browser flags, a clean public install or any changed artifact's behavior. Earlier delivery, attachment, Task, restart and upgrade receipts may be reused only when their artifact/contract scope matches and that reuse is stated explicitly. Host API inspection of a recipient copy, including the prior PDF17S check, is not independent Gmail recipient verification.

## Release acceptance record

For each row in [the bounded journey](smoke.md), record the final Host image/commit/schema, Email package/Runtime identity, whether evidence was reused or freshly observed, and the result. Keep private accounts, credentials, MIME and operational details out of public artifacts. Publish an appropriately redacted outcome summary with release downloads.

Required evidence covers public assets and checksums; Apps in the actual release browser bundle; a standalone clean Email build; Gmail connection/read/HTML/images; attachment draft save/reopen; one reviewed Send and independent recipient verification; Task/source return; restart persistence; Email-only upgrade with unchanged Host; and relevant backend health. Installation, isolation, data-loss and duplicate-send failures remain blockers. Other residuals must be explicit.

## Local source checks

The [README build](../README.md#build-independently), [focused CI](../.github/workflows/ci.yml), Kit pin checks and Runtime provenance establish source/package contracts. They are not live provider tests. The release process uses the actual protected checks on the final integrated commits, including security, rather than substituting earlier green PR heads.

[Historical initial author-independent verification](history/verification-before-public-preview.md) preserves the earlier clean-build and fixture receipts without upgrading their scope. [Historical compatibility](history/compatibility-before-public-preview.md) preserves earlier source offers and artifact pins.
