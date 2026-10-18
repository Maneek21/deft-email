# Developer-preview limitations

This preview demonstrates a connected, independently deployed Email App using public Deft contracts. It is intended for developers and operators, with Gmail as the accepted provider path. It does not promise effortless onboarding, full Gmail/Outlook parity or production-scale operation. Exact published identities and acceptance belong to [the compatibility manifest](../release/compatibility.json) and [verification](verification.md).

## Known behavior

- **Refresh is slow.** In the latest retained demo acceptance, backend Refresh took roughly 4–5.5 seconds while the UI sometimes needed roughly 25–30 seconds to settle. These observations are not a latency guarantee for the final release environment.
- **Partial-access messaging can remain visible.** The demo displayed “Some features need access” while the tested mailbox actions worked. One sender Refresh emitted a parallel 403 alongside a successful 200 and an advanced mailbox timestamp. These are disclosed residuals; a successful mailbox Refresh does not establish every optional permission.
- **Deployment capacity matters.** Two fully enabled Hosts overlapped against a 20-connection demo database and exhausted startup headroom. Stopping the predecessor and restarting the same candidate restored workers. Avoid overlapping fully enabled Hosts without capacity planning; retain rollback assets and confirm workers, pool headroom and readiness after deployment.
- **Operator setup is explicit.** HTTPS, OAuth client configuration, private directional credentials, current registrations, access reviews and finite technical sessions are required. Long-lived human consent does not make a technical lease infinite.
- **Source integrations have their own prerequisites.** Foreground read/Refresh and private draft consent do not publish the signed source projections used by Tasks. Knowledge capture also needs its reviewed policy and publication path. Automatic policy provisioning and notifications are outside this preview.
- **Retention-aware uninstall is incomplete.** Disable/revoke are available lifecycle controls; do not describe a fully working retention-aware uninstall. Preserve account data and unknown execution journals.

## Supported operating envelope

The production Runtime needs a POSIX local persistent filesystem and one service UID/writer. NFS/SMB and multiple writers sharing custody are unsupported. Keep the durable store, key ID and encryption key across restarts and compatible upgrades. Windows supports App development and selected fixtures; some Runtime tests need Linux/OpenSSL.

External images default to automatic for new preferences. A saved Ask choice and Host image policy take precedence; delivery still uses the protected image path. Reading a message does not authorize arbitrary private-network fetches.

Unknown provider outcomes are not automatically retried. Inspect the original result/journal before deciding recovery. Successful provider acceptance alone does not prove recipient delivery. Backup checksums do not establish that restore has been rehearsed.

Multiple accounts are supported through separately reviewed targets. The Inbox filter controls reading; the current Compose account is selected through Email settings. Read, private-store, Send and Organize permissions remain separate. Current configuration size and registration/channel ceilings need operator review during repeated upgrades.

## Outside this preview

Full Outlook/IMAP/provider parity, broad history migration, notifications, complete mobile design, production scale, optional Calendar/Contacts/delegated-tool workflows, and an independently hosted custom-domain/shared inbox are outside the release acceptance scope. Fixture or dormant provider code does not establish live support. [ROADMAP.md](../ROADMAP.md) describes future directions without dates.

The bounded [release acceptance](smoke.md) reuses valid evidence and checks remaining release-critical gaps. It does not require a broad regression campaign, repeated latency cycles, additional cosmetic work or video production. Historical tests remain historical; they are never relabelled as checks of a changed artifact.
