# Deft, Author Kit and Email boundaries

The developer-preview claim is specific: a developer can build this connected Email App from its public repository and public Author Kit packages, sideload it into a compatible Deft Host, deploy its provider Runtime separately, and update Email without changing that Host. It does not claim that operator setup is automatic or that any older Deft release accepts these contracts.

Use [the compatibility manifest](https://github.com/Maneek21/deft-email/releases/download/v1.9.0-preview.27/compatibility.json) for exact artifacts and [verification](verification.md) for acceptance. Historical demo results remain tied to their own versions.

## Ownership

| Layer | Owns | Does not supply |
|---|---|---|
| Deft Host | Authentication, tenant/account authority, signed declarations, trusted rendering/forms/files, private-access reviews, exact-action review, execution receipts, native Tasks/Knowledge and governed source navigation | Email provider credentials, mailbox/MIME behavior or an embedded Email product |
| Public Author Kit | Versioned schemas, parsers, packaging, public bridge and Runtime channel transports | Permission grants, approved effects or a running provider service |
| Email App | Its manifest, views, recipient/draft UI declarations, menu nominations and mailbox presentation requests | Private Host imports or independent authority to send |
| Email Runtime | Provider OAuth custody, encrypted local state, mailbox/MIME/attachment processing, private drafts, source normalization, provider actions and retained uncertain-outcome journals | Tenant policy or the ability to override Host reviews |
| Operator | Compatible Host deployment, HTTPS, provider client, private Runtime registry/configuration, persistent storage and supported enrollment | Authority inferred merely from configuration or endpoint health |

The Runtime's bundled domain helpers and frozen dependency provenance belong to this independent distribution. Their source origins are recorded; no private monorepo packages or Deft source checkout are fetched at build or Runtime startup.

## One external-author path

1. Obtain the exact compatible public Host image and deployment assets; verify schema, compiled Apps gates and signing/provenance.
2. Extract Email corresponding source or check out its exact public commit into a separate directory. Use the exact released Kit42 for both App and Runtime on Host134 or newer, then build `app/app.deft.json` with the [README commands](../README.md#build-independently).
3. Follow [setup](setup.md): public protocol7 stage/review/activate, operator Runtime admission, HTTPS/OAuth, owner resource/action consent and private draft-store consent. Each installation uses newly issued IDs and its own custody.
4. Use Email in the trusted Deft surface. Task/Knowledge interactions use generic source nomination and destination review; they require separately configured observation/publication and destination policy.
5. Make an Email-owned change and follow [the existing private-note upgrade example](independence-upgrade.md). Keep Host source/image/schema fixed and preserve retained draft/Run state. A package upgrade may require current reviewed registrations and same-account reattachment; that is lifecycle configuration, not a Host patch.

The prior built-in Email adapter is not an installation dependency. Do not configure it, copy native mailbox rows or patch SQL to make this example work. The test-only `native-activation-fixture` exercises Host compatibility during integration; its Host fixture paths are not Email production imports or consumer build inputs.

## Permission and action boundaries

Package validity, installation, UI exposure, mailbox access, private record storage and action approval are separate. Review the exact requested scope for the current account and installation. Read does not grant Send; draft storage does not grant provider access; source publication does not grant destination Knowledge access.

Initial account enrollment is finite. Signed policies may offer **Until revoked** through explicit review for account continuation, private storage or observation. An omitted lifetime or a null expiry alone grants nothing. Reviews, requests and technical leases remain finite. Technical renewal checks current membership, scope and custody; expired or revoked authority requires the supported recovery/reissuance path.

Technical sessions may have a finite immutable renewal ceiling or an explicitly Host-issued `renewal_lifetime: "until_revoked"` with `renewable_until: null`. The latter still uses finite rolling leases and does not infer consent from null or replace initial enrollment. Publication needs separate reviewed consent, which may be finite or explicitly `until_revoked` where the Host supports and issues it; technical renewal alone neither grants nor extends it. Unchanged enrollment-file timestamps record issuance; the current Host lease and authority determine whether renewal may continue. See the [Runtime renewal contract](../runtime/runtime-channel-renewal.md).

Every Send still requires exact-message review. The Runtime consumes only the released reviewed claim, with immutable message/files and current authority. An uncertain provider outcome must be inspected through its original receipt/journal; it must not be replayed as a fresh acceptance send.

App resource nomination identifies the Email source; Deft checks that source, audience, destination and typed native Task details. Knowledge capture additionally uses the reviewed capture policy. Mailbox/provider logic stays here while Deft exposes reusable contracts for other apps.
