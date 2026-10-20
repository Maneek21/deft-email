# Supported compatibility and downloads

[`release/compatibility.json`](../release/compatibility.json) is the source template and entry point. Follow its `authoritative_release_manifest` URL for the single authoritative detached cross-component release record. Use that resolved record for exact Host and Email commits, versions, image digests, schema/contracts, Kit artifacts, download locations, checksums and corresponding source. The publication state in that record distinguishes a prepared candidate from a verified public release. Do not replace its pins with a branch tip, a similarly named preview or a demo image.

## Release preview.20 contract

Bundle preview.20 requires Host preview.127 or newer and pairs App 1.9.1-preview.1 with unchanged Runtime preview.18. The detached release record binds the new App and Kit39 to the published Host127 assets. Preview.18 remains available for rollback.

| Component | Version/contract |
|---|---|
| Email App | `1.9.1-preview.1` |
| App Author Kit | `0.1.0-alpha.39` |
| Email Runtime | `0.4.0-preview.18` |
| Runtime Author Kit | `0.1.0-alpha.35` |
| Deft Host | Minimum `0.3.0-preview.127`, Apps-enabled developer-preview image; schema `120` plus the listed generic contracts |
| App protocol | Manifest protocol 7; experience bundle v4; bridge v1; trusted renderer v2 |
| Runtime requirements | Sync-provider channel v3 and mail-provider channel v1; connection protocol v2 |

Kit39 adds the optional `background_refresh_description` contract to the existing reader-menu and account-targeted Refresh contracts. Email supplies the wording; the generic Host validates and displays it. [Kit provenance](background-refresh-description.md). The Runtime retains its sealed Kit35 transport contract; the supported Host accepts both. Do not force the two components onto one Kit version simply to align version labels. `scripts/verify-pins.mjs` verifies their exact sealed bytes, and the Runtime provenance check verifies its retained source closure.

The Host must also provide generic record-form v3, prepared supplemental effects, inspection v2, source nomination v2, reviewed persistent-permission policy, the consent-continuation phase gate and the resource-refresh contract. Schema120 alone does not prove those later fixes are present; use the manifest's exact Host artifact.

Bundle preview.17 pairs App preview.14 and Runtime preview.17 with Host preview.125. Searched and conversation messages are now published as Task sources, so Email → Task works for newly found messages, and draft opening is bounded. Host preview.125 carries the matching Task-review recovery, backend reliability and agent fixes from the 18 October release rehearsal. Both Kit packages are unchanged. Host preview.125 still uses schema120; it adds no migration.

## Verify before installation

1. Obtain the manifest and checksum file from the published Email prerelease identified by the record.
2. Download the Host's supported Apps-enabled image/deployment assets, Email package/source/Runtime assets and both Kit tarballs from the recorded locations. Verify their advertised SHA256 values and Host signing/provenance instructions.
3. Confirm that the actual Host browser bundle contains the Apps, resource-sync and attachment-broker build flags. Setting `NEXT_PUBLIC_*` only at Runtime cannot enable missing compiled features.
4. Confirm the Host's schema and ready status. Keep image version, source commit, image manifest/config digest and database schema as distinct identities.
5. Follow [setup](setup.md), then the bounded [acceptance journey](smoke.md). Read [verification](verification.md) for what was observed rather than inferring live behavior from a green build.

The corresponding-source archive includes frozen Email dependencies and sealed Kit packages. The detached release manifest/checksum assets bind the published archives to their public source. A checksum for an archive must not be embedded as a self-referential checksum inside that same archive.

## Historical evidence

[Earlier compatibility matrices and source offers](history/compatibility-before-public-preview.md) are preserved for reconstruction. Their older schemas, Kit versions, source overlays and demo downloads are historical. They are not alternate installation instructions or acceptance of the current release. [Earlier local verification](history/verification-before-public-preview.md) likewise retains its original artifact scope.
