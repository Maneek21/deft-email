# Developer-preview limitations

This preview demonstrates an independently deployed Email App using public Deft contracts, with Gmail as the accepted provider path. Initial HTTPS, OAuth, Runtime configuration and permission reviews still require an operator. Exact artifacts belong to [the compatibility manifest](https://github.com/Maneek21/deft-email/releases/download/v1.9.0-preview.28/compatibility.json); [verification](verification.md) separates current observations from historical results.

## Known behavior

- **Knowledge capture can briefly retry a mailbox-change race.** The background Knowledge worker can receive `EMAIL_DATA_SOURCE_CHANGED` when synchronization advances the mailbox generation during a read. All 11 investigated events recovered automatically with the same message input in about 10–61 seconds. These were background-worker delays, not observed reader errors or evidence of an old App binding. This is an observed recovery range, not a guarantee for every failure.
- **Settings health is incomplete.** The Email settings health line shows connection/background state but lacks last-sync time and message count because those fields are missing from its Host API. Use Inbox freshness and sync/checkpoint status for progress. Knowledge “need attention” counts do not yet link to individual items.
- **Dated permissions do not auto-renew.** Background refresh now defaults to **Until revoked** and can renew technical sessions automatically while that reviewed permission remains valid. Outage reacquisition additionally requires the configured operator's own account grant; cross-owner service recovery is unsupported. An **Until date** permission stops at its chosen expiry. Technical sessions remain finite even with until-revoked consent.
- **Large mailboxes may hit time budgets.** Runtime authority checks are still sequential, so many checks or a slow Host can consume the bounded operation budget. Consolidating those checks is planned. Catch-up is faster between successful pages, but it is not a guarantee of instant or unlimited synchronization.
- **Refresh and cold reads can still take time.** Historical 18 October observations took roughly 25–30 seconds to settle visually despite 4–5.5-second backend work. Those figures predate the current recovery/UI changes and are not current latency guarantees. Partial coverage and optional missing access do not mean that the whole mailbox connection is broken.
- **Deployment capacity matters.** Two fully enabled Hosts overlapped against a 20-connection demo database and exhausted startup headroom. Stopping the predecessor and restarting the same candidate restored workers. Avoid overlapping fully enabled Hosts without capacity planning; retain rollback assets and confirm workers, pool headroom and readiness after deployment.
- **Permissions stay separate.** Trusted compatible upgrades carry forward existing matching approvals; trust starts off. Changed authority still needs review. Read, private drafts, background publication, destination Knowledge policy and exact-message Send are independent. A connected account or healthy Runtime does not establish every optional permission. Automatic policy provisioning and notifications remain outside this preview.
- **Retention-aware uninstall is incomplete.** Disable/revoke are available lifecycle controls; do not describe a fully working retention-aware uninstall. Preserve account data and unknown execution journals.

## Supported operating envelope

The production Runtime needs a POSIX local persistent filesystem and one service UID/writer. NFS/SMB and multiple writers sharing custody are unsupported. Keep the durable store, key ID and encryption key across restarts and compatible upgrades. Windows supports App development and selected fixtures; some Runtime tests need Linux/OpenSSL.

External images default to **Ask** when no preference exists or an old preference is archived. A saved **Always** choice remains supported, subject to Host policy. Images use the protected delivery path; message reading does not authorize arbitrary private-network fetches.

Opening Reply, Reply all, Forward or Compose uses a local unsaved seed; opening the editor alone does not create a saved draft. The latest recorded live smoke encountered Reply form timeouts. A [follow-up Reply opening fix](https://github.com/Maneek21/deft-email/pull/24) has since merged in source; that earlier smoke does not verify the fix on a deployed release. Save/reopen and exact-message Send remain separate checks.

Unknown provider outcomes are not automatically retried. Inspect the original result/journal before deciding recovery. Independent automatic read recovery can continue while an earlier uncertain read remains recorded. Provider acceptance alone does not prove recipient delivery; backup checksums alone do not prove a restore rehearsal.

Multiple accounts use separately reviewed targets. The Inbox filter controls reading; Compose uses the account selected in Email settings. Current registration/channel ceilings still need operator attention during repeated upgrades. Trusted continuity and service reacquisition do not remove these bounds.

## Outside this preview

Full Outlook/IMAP/provider parity, broad history migration, notifications, complete mobile design, production scale, optional Calendar/Contacts/delegated-tool workflows, and an independently hosted custom-domain/shared inbox are outside the release acceptance scope. Fixture or dormant provider code does not establish live support. [ROADMAP.md](../ROADMAP.md) describes future directions without dates.

The contracts/Wiki work to move shared contracts to a neutral owner, and the full Knowledge/Calendar migration described in the Host's #378 plans, are deferred. Current Task/source and governed Knowledge integrations do not mean that migration is complete. See the [roadmap](../ROADMAP.md).

## Bounded recovery

Retained-account upgrade handshakes have a maximum 120-second phase, with matching authenticated response-socket handling and a 30-second authority-callback cap. Ordinary authority clients retain their shorter cap. Metadata observation has a maximum 60-second operation phase. These are ceilings, not promised response times: current authority expiry, dated consent, caller cancellation and Host leases still bound the work. No provider effect or Send is retried by these recovery paths.

If a preserved review has no Runtime journal/session, product status can resolve it even beside a different expired prepared reservation for the same exact scope. It preserves that old reservation and custody. A live, possibly activated or changed-scope request still requires its original status/receipt handling; operators must not edit the database or replay it.
