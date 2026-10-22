# Email developer preview for Deft

Email is an independently built, sideloaded App and a separately deployed Email Runtime. It demonstrates a complex connected app built with the public Deft Author Kit: Gmail, reviewed sending, private drafts and files, native Tasks, and governed Knowledge capture.

**Start here: [Setup](docs/setup.md) · [Compatibility and downloads](docs/compatibility.md) · [Roadmap](ROADMAP.md) · [Known limitations](docs/limitations.md).**

This is a developer preview for operators and app authors. Installation requires a compatible Apps-enabled Deft Host, HTTPS, an OAuth client, private Runtime configuration and explicit permissions. It is not a production-grade Gmail or Outlook replacement.

## The boundary

- **Deft Host** provides identity, tenant isolation, trusted rendering, private-access review, native Tasks/Knowledge, reviewed actions and receipts.
- **Author Kit** supplies versioned public schemas, packaging and Runtime transport contracts. It does not grant access.
- **Email App and Runtime**, owned in this repository, provide mailbox UI declarations, provider integration, credentials, encrypted mailbox/draft state, MIME, attachments and sending.

Email builds without a Deft source checkout or private Deft imports. Operators use public Host contracts and configuration; Email development does not require an Email-specific Host patch. Read the [boundary and author workflow](docs/author-independence.md).

## Supported compatibility set

The [published compatibility manifest](https://github.com/Maneek21/deft-email/releases/download/v1.9.0-preview.29/compatibility.json) is the authoritative detached public release record. The repository [`release/compatibility.json`](release/compatibility.json) is its source template and also records that URL. The published record identifies the Host version/commit/image/schema, App and Runtime versions, each component's Kit, public assets, checksums and corresponding source. Use its verified publication state and release assets; a candidate record or open PR does not establish that downloads are available.

Release bundle **1.9.0-preview.29** builds App **1.9.1-preview.10** and Runtime **0.4.0-preview.27**, both with the exact published Kit **0.1.0-alpha.42** from Host134. Email owns its author/runtime domain modules and uses clean Kit entry points. The supported Host requires schema **131** and the exact generic contracts in the manifest. An older stable Host or a matching schema number alone is insufficient.

This release requires Host **0.3.0-preview.136 or newer**. It adds read-only Reply source reuse with fresh final checks, alongside clearer mailbox states and action notices, early technical renewal, scoped service reacquisition after expired leases, durable Gmail refresh reconciliation and a process-lifetime writer lock. A Host-authorized, receipt-backed registration transition lets a trusted compatible App upgrade continue without operator-file or token edits. Host installation trust is explicitly off by default; current account, private-storage, metadata and effect permissions remain independent. No renewal or recovery path sends a message or retries a provider effect. [Recovery and rollout details](runtime/UNATTENDED-RECOVERY.md).

For an installation whose administrator has enabled **Compatible update trust**, a compatible upgrade keeps existing account access, background refresh and matching private-storage approvals. Owners do not repeat those reviews or reconnect just because the version changed. Changes to permissions, provider scope, actions, destinations or other authority still need review. Background refresh now defaults to **Until revoked**; a dated permission keeps its chosen expiry and does not auto-renew. See [connect-once setup and controls](docs/setup.md#connect-once-operation).

Host125 / Email18 introduced Host-delivered background sessions after owner recovery. Host131–133 / Email21–26 added unattended service reacquisition and reliable trusted-upgrade handshakes. Host136 / Email28 is the current supported set; the older recovery-only instructions are historical.

## Build independently

Download and checksum-verify the Email corresponding-source archive named in the compatibility record, extract it into an empty directory, and run the commands below there. The archive includes sealed Kit tarballs and frozen lockfiles. Alternatively, check out the record's exact public Email source commit.

Use Node >=22.13.0, npm 11.9.0 and pnpm 10.33.0. Linux/POSIX is required to operate the Runtime; Windows can build the App, while some Runtime fixtures require Linux and OpenSSL.

```sh
npm --prefix app ci --no-audit --no-fund
pnpm --dir runtime install --frozen-lockfile --ignore-scripts
npm run verify:provenance
npm run build
npm run test:app
npm run test:ui
npm run test:runtime:preview
```

The build writes `app/app.deft.json`, `app/artifact.json`, `app/worker.bundle.js` and `app/build-result.json`. Runtime source is native ESM and needs no compilation. No copied `node_modules`, private artifacts or Deft checkout are build inputs. The [focused CI workflow](.github/workflows/ci.yml) checks these local contracts; it does not by itself prove provider delivery.

Follow [setup](docs/setup.md) to obtain the compatible Host, sideload the generated package, deploy the Runtime, enroll current authority and connect Gmail. Follow [the bounded acceptance journey](docs/smoke.md) to exercise the result. Then use the [existing Email-only upgrade example](docs/independence-upgrade.md) against an unchanged Host.

## Preview capabilities and limits

The implementation includes multiple connected Gmail accounts, explicit Refresh, text/HTML and external images, private drafts and attachments, exact-message Send review, mailbox actions, Task/source navigation and policy-controlled Knowledge capture. Publication and live acceptance are recorded separately in [verification](docs/verification.md); historical receipts apply only to their original artifacts.

Background catch-up continues across pages while older mail is still syncing; it does not wait a full polling interval between successful pages. A trusted Email28 upgrade was observed to resume automatically with all 112 retained messages and zero owner permission or recovery steps. This is a bounded observation, not a timing or scale guarantee. Knowledge capture can briefly retry a mailbox-change race; settings still lack last-sync time and message count. Shared inboxes, full provider parity, production scale and mobile completeness remain outside this preview. See [limitations](docs/limitations.md), [verification](docs/verification.md) and the [roadmap](ROADMAP.md).

## Source and license

[Email source](https://github.com/Maneek21/deft-email) is separate from [Deft and Author Kit source](https://github.com/Maneek21/Deft). Versioned Kit tarballs are distributed with the supported preview; npm publication is not an installation prerequisite. [Release instructions](docs/release.md) explain checksums, provenance and corresponding source.

AGPL-3.0-only. Preserve [LICENSE](LICENSE), [NOTICE](NOTICE) and [third-party notices](THIRD-PARTY-LICENSES.md). Runtime provenance is verified by `npm run verify:provenance`. Credentials, custody, mailbox contents and private operational evidence do not belong in public source or release artifacts.
