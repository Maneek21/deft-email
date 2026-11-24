# Supported compatibility and downloads

[`release/compatibility.json`](../release/compatibility.json) is the source template and entry point. Follow its `authoritative_release_manifest` URL for the single authoritative detached cross-component release record. Use that resolved record for exact Host and Email commits, versions, image digests, schema/contracts, Kit artifacts, download locations, checksums and corresponding source. The publication state in that record distinguishes a prepared candidate from a verified public release. Do not replace its pins with a branch tip, a similarly named preview or a demo image.

## Release preview.35 contract

Bundle preview.35 adds the per-workspace send cap (#38). It requires Host138 or newer and pairs App1.9.1-preview.13 with Runtime0.4.0-preview.32; App13 differs from App12 only in the notice below, and the reviewed Send output schema is unchanged. App12's Send status check has no text for a refused Send and falls back to its generic "current delivery receipt is unavailable" message; install App13 to see the limit.

- **What it does.** Runtime32 limits how many emails one workspace can send in any rolling hour and any rolling 24 hours. Receiving, reading and organizing mail are not capped. A Send takes its slot, keyed by its Run id, in the same locked step that checks the limit, just before the provider is called, and gives it back only when it is known not to have reached the provider. Accepted, partly accepted and uncertain Sends count; a retry of the same Run never counts twice; a restart keeps the counts (#38, `docs/setup.md#workspace-send-cap`).
- **Settings.** `EMAIL_RUNTIME_SEND_LIMIT_HOURLY` and `EMAIL_RUNTIME_SEND_LIMIT_DAILY`, read from the helper's environment when it starts. Each is a whole number from 1 to 10000.
- **Defaults when a setting is absent.** The hosted form helper (form mode with `registration_admission: "host_authority"`) uses 200 an hour and 2,000 a day. A self-hosted helper, including every OAuth-mode helper, has no cap until the operator sets one.
- **Invalid value.** Any other value, the empty string included (`EMAIL_RUNTIME_SEND_LIMIT_HOURLY=`), makes the helper refuse to start with `EMAIL_RUNTIME_CONFIG_INVALID`, in form mode and OAuth mode alike. Nothing is clamped or ignored.
- **When it is reached.** The Send is refused before any provider call and the Run ends failed with `primary_outcome: "send_limit_reached"`. The draft is kept, and Email shows on it: "Not sent. This workspace has sent 200 emails in the last hour, its limit. Sending starts again at about 2:20 PM. This message is kept, and receiving email is not affected." (the number is the limit that applies, "24 hours" replaces "hour" for the daily limit, and a weekday is added when sending resumes more than twelve hours away or on another day). The refused Run never sends later; sending the kept draft again starts a new reviewed Run. The helper writes one `email_send_limit_reached` log line per window and has no channel to message administrators.

Runtime32 otherwise carries Runtime31 unchanged. Kit pins and every Host contract are unchanged.

## Release preview.34 contract

Bundle preview.34 is a Runtime-only repair requiring Host138 or newer and pairing the unchanged App1.9.1-preview.12 from preview.33 with Runtime0.4.0-preview.31. Runtime31 starts in hosted form mode from the operator image's own command, `node server.mjs`; Runtime30 exited 13 there on an import cycle under its top-level await, so the credential form never started. `readOperatorJson` moved into `runtime/operator-json.mjs` and `server.mjs` re-exports it unchanged. OAuth mode was unaffected. Runtime31 otherwise carries Runtime30 unchanged, including the credential form and both opt-in settings. App bytes, Kit pins and every Host contract are unchanged.

## Release preview.33 contract

Bundle preview.33 is a Runtime-only change requiring Host138 or newer and pairing the unchanged App1.9.1-preview.12 from preview.32 with Runtime0.4.0-preview.30. Runtime30 lets an owner connect a mailbox with mail-server details and a password on the Runtime's own credential form (#34). Two new Runtime settings are opt-in: `provider_config.endpoint_policy: {"mode":"public_addresses"}` admits any public mail server under the existing address and certificate checks, and `registration_admission: "host_authority"` accepts a registration the configured Host confirms over the existing form authority call. Without them, endpoint allowlists and configured registration pins remain enforced, and the retry, replacement-recovery and SMTP authentication fixes also apply to existing configurations; Runtime29 and earlier refuse to start with either. A refused login can be retried on the same page, with failed checks capped per owner and target. App bytes, Kit pins and every Host contract are unchanged: the Host's form authority route is identical from Host138 through Host143. A hosted cell that connects mailboxes without a hand-written Host connections entry per mailbox additionally needs the Host's `hosted_templates` (Deft #538), which postdates Host143; that is a Host deployment option, not an Email requirement.

## Release preview.32 contract

Bundle preview.32 is a Runtime-only repair requiring Host138 or newer and pairing the unchanged App1.9.1-preview.12 from preview.31 with Runtime0.4.0-preview.29. Runtime29 starts when a reattached session was later disconnected by the Runtime itself: registration continuity accepts that receipted successor only when it differs from the receipted session exactly by the disconnect fields, and keeps the same enrollment. App bytes, Kit pins and every Host contract are unchanged.

## Release preview.31 contract

Bundle preview.31 is an App-only no-diff upgrade candidate requiring Host138 or newer and pairing App1.9.1-preview.12 with the exact unchanged Runtime0.4.0-preview.28 from preview.30. No Runtime redeployment is required. Read-only Reply hydration uses current-source presentation data while repeating fresh authority checks; first-save revalidation is unchanged. Both use the exact Kit42 archive published by Host134. Historical Kits and their original source offers remain immutable. Rollback requires matched Host/App/Runtime and data snapshots.

| Component | Version/contract |
|---|---|
| Email App | `1.9.1-preview.13` |
| App Author Kit | `0.1.0-alpha.42` |
| Email Runtime | `0.4.0-preview.32` |
| Runtime Author Kit | `0.1.0-alpha.42` |
| Deft Host | Minimum `0.3.0-preview.138`, Apps-enabled developer-preview image; schema `131` plus the listed generic contracts |
| App protocol | Manifest protocol 7; experience bundle v4; bridge v1; trusted renderer v2 |
| Runtime requirements | Sync-provider channel v3 and mail-provider channel v1; connection protocol v2 |

Kit42 isolates app-owned domain behavior behind clean core and experience/core entries while retaining deprecated compatibility exports. Both consumers adopt its exact published Host134 bytes; this is a reviewed API/ownership migration. [Release provenance](kit42-preparation.md), immutable pins, both frozen locks, and vendor/domain provenance checks bind the artifact.

Host138 reduces generic current-authority payload, validation and SQL costs. Deploy it before enabling App12/Runtime28. Host137 supplied opted-in compound seed snapshots and current-opening recovery proof; Host136 supplied generic source-seeded forms, scoped read recovery and hidden-image presentation; Runtime27 also preserves the old source_refs creation path. The Host must also provide generic record-form v3, prepared supplemental effects, inspection v2, source nomination v2, reviewed persistent-permission policy, the consent-continuation phase gate and the resource-refresh contract. Schema131 alone does not prove those later fixes are present; use the manifest's exact Host artifact.

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
