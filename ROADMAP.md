# Email roadmap

Email is the reference implementation for a complex, independently deployed Deft App built with the public Author Kit. The current release is a developer preview, not a promise of complete Gmail/Outlook parity. The [published compatibility manifest](https://github.com/Maneek21/deft-email/releases/download/v1.9.0-preview.17/compatibility.json) and [verification record](docs/verification.md) determine which exact artifacts are published and accepted. The repository's [compatibility file](release/compatibility.json) is the source template, not proof of publication.

This roadmap separates the preview's implementation from its known limits and possible future work. It promises no dates and does not expand the current release.

## Current developer-preview capability set

- Independently build and sideload the Email App into a compatible Deft Host; deploy its Runtime separately.
- Connect Gmail accounts with distinct account authority and private Runtime credential custody.
- Read and manually refresh messages, render HTML and permitted external images, and use ordinary mailbox actions.
- Save and reopen private drafts and attachments, then send through exact-message review and retained execution receipts.
- Nominate an Email source for native Tasks and return through its access-checked backlink.
- Publish governed sources for Knowledge capture under a separately reviewed policy and configured observation lane.
- Update Email through public package/lifecycle contracts without modifying the compatible Host.

These are the shipped scope when the release is marked published; [acceptance](docs/verification.md) states the evidence and any unverified behavior. Package validity, an installed app and a successful live journey are different claims.

## Known limitations and near-term reliability work

- Reduce visible Refresh and cold-load delays, and make loading and partial-access states clearer.
- Simplify operator setup, account enrollment, finite technical renewal and supported upgrade recovery.
- Improve deployment startup headroom, recoverable worker startup, observability and capacity guidance.
- Expand restart, backup/restore and retention-aware uninstall confidence without discarding uncertain-send journals.
- Make Task/Knowledge publication setup and operational status easier to understand.
- Improve provider fault handling and mobile usability without automatically retrying uncertain sends.

See [known limitations](docs/limitations.md) for current deployment constraints. These are improvements to pursue, not additional release gates after the scoped preview is accepted.

## Independent custom-domain and shared inbox

A future Email Runtime could own durable mailbox state for custom-domain and shared company inboxes. Provider delivery infrastructure would feed and deliver mail; the Runtime would own incoming-message processing, storage, thread and attachment state, permissions within the shared inbox, drafts and outbound delivery state.

**Amazon SES versus Resend is an undecided future infrastructure choice.** Their suitability for both sending and receiving, inbound event delivery, storage integration, domain setup, operational limits and recovery would need evaluation. Neither is selected or integrated by this roadmap. SMTP alone supplies a transport for sending; it does not supply incoming-mail processing or mailbox storage.

Possible shared company workflows include support queues, sales enquiries and invoice handling, with assignment and collaboration connected to Deft Tasks and Knowledge. Those mailbox and provider behaviors belong in the independent Email App/Runtime. Deft should expose reusable identity, permission, record, review and integration capabilities rather than email-specific product code.

## Retain connected Gmail

Connected Gmail remains an adoption option. A company should be able to try Email inside Deft with an existing mailbox before choosing a custom-domain/shared-inbox deployment. A future independent mailbox should not require removing that path or migrating every user immediately.

## Later provider and operational maturity

Broader Microsoft/other-provider support, fuller search/history behavior, provider-specific features, sustained synchronization, notifications, accessibility/mobile refinements, monitoring, quotas, migration and disaster recovery are future directions. Existing provider fixture code is not a claim that each provider has the Gmail preview's live acceptance coverage.

Each expansion should preserve independently versioned Email releases, public Kit contracts, current authority checks and safe handling of unknown outcomes. Compatibility and evidence should grow with the supported surface rather than imply universal provider parity.
