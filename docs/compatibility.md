# Supported compatibility and downloads

[`release/compatibility.json`](../release/compatibility.json) is the source template and entry point. Follow its `authoritative_release_manifest` URL for the single authoritative detached cross-component release record. Use that resolved record for exact Host and Email commits, versions, image digests, schema/contracts, Kit artifacts, download locations, checksums and corresponding source. The publication state in that record distinguishes a prepared candidate from a verified public release. Do not replace its pins with a branch tip, a similarly named preview or a demo image.

## Release preview.27 contract

Bundle preview.27 requires Host134 or newer and pairs App1.9.1-preview.8 with Runtime0.4.0-preview.25. Both use the exact Kit42 archive published by Host134. Historical Kits and their original source offers remain immutable. Rollback requires matched Host/App/Runtime and data snapshots.

| Component | Version/contract |
|---|---|
| Email App | `1.9.1-preview.8` |
| App Author Kit | `0.1.0-alpha.42` |
| Email Runtime | `0.4.0-preview.25` |
| Runtime Author Kit | `0.1.0-alpha.42` |
| Deft Host | Minimum `0.3.0-preview.134`, Apps-enabled developer-preview image; schema `131` plus the listed generic contracts |
| App protocol | Manifest protocol 7; experience bundle v4; bridge v1; trusted renderer v2 |
| Runtime requirements | Sync-provider channel v3 and mail-provider channel v1; connection protocol v2 |

Kit42 isolates app-owned domain behavior behind clean core and experience/core entries while retaining deprecated compatibility exports. Both consumers adopt its exact published Host134 bytes; this is a reviewed API/ownership migration. [Release provenance](kit42-preparation.md), immutable pins, both frozen locks, and vendor/domain provenance checks bind the artifact.

The Host must also provide generic record-form v3, prepared supplemental effects, inspection v2, source nomination v2, reviewed persistent-permission policy, the consent-continuation phase gate and the resource-refresh contract. Schema131 alone does not prove those later fixes are present; use the manifest's exact Host artifact.

Bundle preview.17 pairs App preview.14 and Runtime preview.17 with Host preview.125. Searched and conversation messages are now published as Task sources, so Email → Task works for newly found messages, and draft opening is bounded. Host preview.125 carries the matching Task-review recovery, backend reliability and agent fixes from the 18 October release rehearsal. Both Kit packages are unchanged. Host preview.125 still uses schema120; it adds no migration.

Runtime19 renews short sessions early and reacquires expired sessions through scoped Host service authority. Trusted compatible upgrades enroll only receipt-backed successor registrations; they do not rewrite operator configuration. Stop the previous Runtime cleanly before starting the new single writer against the same encrypted store and key. [Recovery details](../runtime/UNATTENDED-RECOVERY.md).

## Verify before installation

1. Obtain the manifest and checksum file from the published Email prerelease identified by the record.
2. Download the Host's supported Apps-enabled image/deployment assets, Email package/source/Runtime assets and both Kit tarballs from the recorded locations. Verify their advertised SHA256 values and Host signing/provenance instructions.
3. Confirm that the actual Host browser bundle contains the Apps, resource-sync and attachment-broker build flags. Setting `NEXT_PUBLIC_*` only at Runtime cannot enable missing compiled features.
4. Confirm the Host's schema and ready status. Keep image version, source commit, image manifest/config digest and database schema as distinct identities.
5. Follow [setup](setup.md), then the bounded [acceptance journey](smoke.md). Read [verification](verification.md) for what was observed rather than inferring live behavior from a green build.

The corresponding-source archive includes frozen Email dependencies and sealed Kit packages. The detached release manifest/checksum assets bind the published archives to their public source. A checksum for an archive must not be embedded as a self-referential checksum inside that same archive.

## Historical evidence

[Earlier compatibility matrices and source offers](history/compatibility-before-public-preview.md) are preserved for reconstruction. Their older schemas, Kit versions, source overlays and demo downloads are historical. They are not alternate installation instructions or acceptance of the current release. [Earlier local verification](history/verification-before-public-preview.md) likewise retains its original artifact scope.
