# Supported compatibility and downloads

Use the [published Email28 compatibility manifest](https://github.com/Maneek21/deft-email/releases/download/v1.9.0-preview.28/compatibility.json) for the shipped set documented here: exact Host and Email commits, versions, image digests, schema/contracts, Kit artifacts, downloads, checksums and corresponding source. The repository [`release/compatibility.json`](../release/compatibility.json) now prepares Email29 and points to that candidate's intended detached record. Its source-template state does not establish publication or deployment acceptance. Do not replace published pins with a branch tip, a similarly named preview or a demo image.

## Shipped preview.28 contract

Bundle preview.28 requires Host 136 or newer and pairs App `1.9.1-preview.9` with Runtime `0.4.0-preview.26`. Both use the exact Kit alpha.42 archive published by Host 134. Historical Kits and their original source offers remain immutable. Rollback requires matched Host/App/Runtime and data snapshots.

| Component | Version/contract |
|---|---|
| Email App | `1.9.1-preview.9` |
| App Author Kit | `0.1.0-alpha.42` |
| Email Runtime | `0.4.0-preview.26` |
| Runtime Author Kit | `0.1.0-alpha.42` |
| Deft Host | Minimum `0.3.0-preview.136`, Apps-enabled developer-preview image; schema `131` plus the listed generic contracts |
| App protocol | Manifest protocol 7; experience bundle v4; bridge v1; trusted renderer v2 |
| Runtime requirements | Sync-provider channel v3 and mail-provider channel v1; connection protocol v2 |

Kit42 isolates app-owned domain behavior behind clean core and experience/core entries while retaining deprecated compatibility exports. Both consumers adopt its exact published Host134 bytes; this is a reviewed API/ownership migration. [Release provenance](kit42-preparation.md), immutable pins, both frozen locks, and vendor/domain provenance checks bind the artifact.

Host136 adds generic source-seeded forms, scoped read recovery, parallel preflight and hidden-image presentation. Deploy it before enabling App9; Runtime26 also preserves the old source_refs creation path. The Host must also provide generic record-form v3, prepared supplemental effects, inspection v2, source nomination v2, reviewed persistent-permission policy, the consent-continuation phase gate and the resource-refresh contract. Schema131 alone does not prove those later fixes are present; use the manifest's exact Host artifact.

Historically, bundle preview.17 paired App preview.14 and Runtime preview.17 with Host preview.125. It added Task sources for searched and conversation messages and bounded draft opening. Host preview.125 carried the matching Task-review recovery, backend reliability and agent fixes from the 18 October release rehearsal. Both Kit packages stayed unchanged. Host preview.125 used schema120; it added no migration.

Host 131–133 and Email 21–26 introduced scoped service reacquisition after expired short leases and completed the trusted-upgrade handshake fixes. On the current set, an administrator can enable per-installation **Compatible update trust** (off by default). Compatible activation carries matching account, background and private-data approvals forward with fresh registrations/sessions; changed authority still needs review. No operator-file or token edit is needed. The **Until revoked** background default supports renewal/recovery; a dated permission does not auto-renew. Stop the previous Runtime cleanly before starting the single successor against the same encrypted store/key. See [setup and controls](setup.md#connect-once-operation) and [recovery details](../runtime/UNATTENDED-RECOVERY.md).

Host 136 / Email 28 also adds source-seeded unsaved Compose/Reply, scoped read recovery and an **Ask** default for external images. Authority HTTP 401/403 remains a permission denial rather than being labelled a Runtime outage. The recorded Reply timeout, its later merged source fix, and settings/Knowledge limits are disclosed in [limitations](limitations.md). That follow-up fix is separate from the Email28 acceptance evidence.

## Prepared preview.29 source

[Email #24](https://github.com/Maneek21/deft-email/pull/24) merged the read-only Reply opening fix and prepares Email29 / App `1.9.1-preview.10` / Runtime `0.4.0-preview.27`. Reply hydration reuses exact current reader presentation data while repeating fresh authority and disclosure checks; first-save source revalidation remains required. Kit42 is unchanged. Host136 remains the wire-contract minimum, but release and deployment are held for the coordinated Host137 acceptance step. This prepared source is separate from the shipped Email28 matrix above; see [release instructions](release.md).

## Verify before installation

1. Obtain the manifest and checksum file from the published Email prerelease identified by the record.
2. Download the Host's supported Apps-enabled image/deployment assets, Email package/source/Runtime assets and both Kit tarballs from the recorded locations. Verify their advertised SHA256 values and Host signing/provenance instructions.
3. Confirm that the actual Host browser bundle contains the Apps, resource-sync and attachment-broker build flags. Setting `NEXT_PUBLIC_*` only at Runtime cannot enable missing compiled features.
4. Confirm the Host's schema and ready status. Keep image version, source commit, image manifest/config digest and database schema as distinct identities.
5. Follow [setup](setup.md), then the bounded [acceptance journey](smoke.md). Read [verification](verification.md) for what was observed rather than inferring live behavior from a green build.

The corresponding-source archive includes frozen Email dependencies and sealed Kit packages. The detached release manifest/checksum assets bind the published archives to their public source. A checksum for an archive must not be embedded as a self-referential checksum inside that same archive.

## Historical evidence

[Earlier compatibility matrices and source offers](history/compatibility-before-public-preview.md) are preserved for reconstruction. Their older schemas, Kit versions, source overlays and demo downloads are historical. They are not alternate installation instructions or acceptance of the current release. [Earlier local verification](history/verification-before-public-preview.md) likewise retains its original artifact scope.
