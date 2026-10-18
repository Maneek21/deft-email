# Email-only upgrade example

The existing example is an optional private note on a draft, up to 1000 characters, kept out of outgoing MIME. It is already implemented; no new feature is needed to demonstrate independence. New drafts may use the note, while retained pre-note drafts keep their original form without an on-read migration.

Current App and Runtime identities come from [the compatibility manifest](../release/compatibility.json). This source is App `1.9.0-preview.13` with Kit38 and Runtime `0.4.0-preview.15` with Kit35. Historical App7/Runtime9 upgrade/retention receipts apply only to those frozen versions. [Verification](verification.md) records which final-release evidence was reused and which checks were rerun.

## Demonstrate the boundary

1. Record the compatible Host source, image digest and schema. Keep all three unchanged throughout the Email upgrade. Record the baseline Email package/Runtime identities and current account registrations.
2. Save a controlled attachment draft before upgrading and retain its original record identity. Keep its files, encrypted store/key and original Run journals.
3. Build the already-existing note-enabled Email version from public source using the documented standalone build. For ordinary future development, an App upgrade must have a strictly newer App version and freshly generated package digests; do not reuse a version with different bytes.
4. Use the public protocol7 package upgrade review/activation. Settle or preserve original work according to lifecycle rules, use the Host's current review request, and require zero activation blockers. Obtain current registrations and use supported same-account reattachment when required. Do not copy demo IDs or mutate Host/database source.
5. If the selected Email Runtime changes, deploy its exact compatible artifact serially with one writer, preserving custody and encrypted state. A Runtime update is still independent of the unchanged Host.
6. Reopen the retained draft and attachment and confirm original values/forms remain. Create a new draft and inspect the private note control. Confirm the note is not part of outgoing message content; local fixtures cover its MIME exclusion without requiring another live Send.
7. Record the before/after Email identities and unchanged Host identity. Preserve original uncertain outcomes rather than retrying them to make the demo appear complete.

Package/parser/restart fixtures establish local contracts. An installed upgrade, retained draft and new form observed through the normal UI establish the live demonstration. A source-only change or an older upgrade receipt is not a new live pass.
