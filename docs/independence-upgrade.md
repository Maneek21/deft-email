# Email-only upgrade example

The existing example is an optional private note on a draft, up to 1000 characters, kept out of outgoing MIME. It is already implemented; no new feature is needed to demonstrate independence. New drafts may use the note, while retained pre-note drafts keep their original form without an on-read migration.

The shipped App and Runtime identities come from [the Email28 compatibility manifest](https://github.com/Maneek21/deft-email/releases/download/v1.9.0-preview.28/compatibility.json): App `1.9.1-preview.9` and Runtime `0.4.0-preview.26`. Current source prepares Email29 / App `1.9.1-preview.10` / Runtime `0.4.0-preview.27`, with release/deployment held for coordinated Host137 acceptance. Both sets retain published Kit42 from Host134. Historical App7/Runtime9 upgrade/retention receipts apply only to those frozen versions. [Verification](verification.md) records each observation's scope.

## Trusted compatible upgrade and restart recovery

On the current Host136 / Email28 set, an administrator can enable **Compatible update trust** for this installation in **Settings → Apps**. Trust is off by default. Compatible activation carries matching account, action, background/publication, private-store and private Experience approvals forward through fresh bindings and custody receipts. The Runtime accepts the receipt-backed successor without operator-file or token edits. For the configured operator's own account, it also reacquires expired short sessions without a browser while until-revoked permission remains valid. Dated permission expiry and revocation remain binding; changed authority still requires review. **Turn off upgrade trust** stops future carry-forward and fences pending proofs. See [the full controls and permission boundaries](setup.md#connect-once-operation).

Keep the previous matched Host/App/Runtime artifacts and database/encrypted-store backups for rollback. Stop the previous Runtime cleanly before its successor opens the same store; never run both writers. [Unattended recovery](../runtime/UNATTENDED-RECOVERY.md) explains the service and custody checks. The 21 October Email26 restart/outage check and 22 October Email28 upgrade check resumed automatically without new owner permission/recovery steps; [verification](verification.md) records their scope and residuals.

## Upgrade from the local demo build

The demo previously installed `1.9.0-preview.14-local.20261018`. SemVer treats `14-local` as an alphanumeric prerelease identifier, which sorts above every numeric identifier in `1.9.0-preview.N`. Consequently the published preview.19 bundle (App `1.9.0-preview.15`) cannot upgrade that installation. Bundle preview.20 uses App `1.9.1-preview.1`, whose higher patch version admits the upgrade without changing Host validation or rewriting installed history. Preview.19 assets remain immutable. Runtime preview.18 is unchanged.

## Demonstrate the boundary

1. Record the compatible Host source, image digest and schema. Keep all three unchanged throughout the Email upgrade. Record the baseline Email package/Runtime identities and current account registrations.
2. Save a controlled attachment draft before upgrading and retain its original record identity. Keep its files, encrypted store/key and original Run journals.
3. Build the already-existing note-enabled Email version from public source using the documented standalone build. For ordinary future development, an App upgrade must have a strictly newer App version and freshly generated package digests; do not reuse a version with different bytes.
4. Use the public protocol7 package upgrade review/activation. Settle or preserve original work according to lifecycle rules, use the Host's current review request, and require zero activation blockers. With upgrade trust on and unchanged authority, let the Host/Runtime deliver current registrations and carry approvals forward automatically. Use supported owner review/reattachment only when the compatibility or authority checks require it. Do not copy demo IDs or mutate Host/database source.
5. If the selected Email Runtime changes, deploy its exact compatible artifact serially with one writer, preserving custody and encrypted state. A Runtime update is still independent of the unchanged Host.
6. Reopen the retained draft and attachment and confirm original values/forms remain. Create a new draft and inspect the private note control. Confirm the note is not part of outgoing message content; local fixtures cover its MIME exclusion without requiring another live Send.
7. Record the before/after Email identities and unchanged Host identity. Preserve original uncertain outcomes rather than retrying them to make the demo appear complete.

Package/parser/restart fixtures establish local contracts. An installed upgrade, retained draft and new form observed through the normal UI establish the live demonstration. A source-only change or an older upgrade receipt is not a new live pass.
