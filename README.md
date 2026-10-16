# Email developer preview for Deft

Email is a separately built sideloaded App with an external Email Runtime. The App uses Deft's generic trusted renderer; the Runtime owns provider custody, mailbox state, MIME, drafts, files and reviewed sending. Deft supplies account authority, native records, reviewed actions and Task/source navigation.

This checkout builds App `1.9.0-preview.9` with Kit `0.1.0-alpha.37` and Runtime `0.4.0-preview.11` with unchanged Kit `0.1.0-alpha.35`. The reader's top More menu nominates its exact current message for native Task creation or Knowledge settings through generic Host contracts. Runtime presentation uses the actual subject and defaults external images to automatic unless this account has saved an ask preference; Host policy and protected proxy delivery remain authoritative. The compact selection/reader layout, optional private draft note, reviewed Until revoked policies and exact-message Send review remain. It requires Host schema120 plus the matching generic integration-menu contract. Source checks and live acceptance are separate; older receipts prove only their exact versions. See [compatibility](docs/compatibility.md).

## Build from this repository

Use Node >=22.13.0, npm 11.9.0 and pnpm 10.33.0. The current local toolchain is Node24.14.0; production Node22 remains the supported baseline. Packed Kit37 for the App and Kit35 for the Runtime are included with fixed lock integrity and SHA256 checks in `scripts/verify-pins.mjs`; older sealed packages are preserved. No Deft developer checkout or copied `node_modules` is required. The operator separately supplies a compatible Host image, HTTPS/OAuth client and private registration/configuration files. App development requires no Email-specific Host source patch, SQL change or built-in Email adapter.

```sh
npm --prefix app ci --no-audit --no-fund
pnpm --dir runtime install --frozen-lockfile --ignore-scripts
npm run verify:provenance
npm run build
npm run test:app
npm run test:ui
npm run test:runtime:preview
pnpm --dir runtime run test:uuid
```

The app build writes `app/app.deft.json`, `app/artifact.json`, `app/worker.bundle.js` and `app/build-result.json`. The Runtime is native ESM source and needs no compilation. `npm run test:runtime` runs its inherited fixture suite; some TLS/POSIX fixtures require Linux and OpenSSL. Test transport and fixture passes do not prove live provider delivery.

[Email focused checks](.github/workflows/ci.yml) runs the locked install, Kit/vendor provenance, App build/package/UI tests and focused Runtime UUID/foreground contracts on Linux. It needs no deployment secrets, operator configuration or mailbox credentials. A green job proves those local contracts; live acceptance and a fresh public installation remain separate checks.

`npm run package:source` produces `dist/email-<version>-source.tar.gz`, `dist/runtime-artifact.tgz` and a per-file SHA256 manifest with both archive hashes. It includes App/Runtime source, tests, licenses, lockfiles and pinned Kit packages. It excludes installed dependencies, generated app outputs, local state and private operator files. The Runtime archive has one `runtime/` prefix for the operator Docker recipe's strip-components step, and retains its frozen lockfile. This optional packaging step uses Python3's standard library with fixed timestamps, ownership, modes and sorted file order; App/Runtime build and execution use Node. Release archives should be assembled after the candidate freezes.

## Install and connect

Schema 118 corrected the earlier supplemental-effect database mismatch and accepted the preceding App preview.3 through the public upgrade path. That installed proof does not establish acceptance of this checkout. That schema118 result is historical; this candidate requires schema120. Final artifact closure, live functional acceptance and the Email-only upgrade remain pending; see [compatibility](docs/compatibility.md). First obtain a Host whose public and database contracts both support this package; use its exact verified source/image/schema pins. A stable release number alone does not establish these preview contracts. Follow [setup](docs/setup.md) to register the Runtime, configure OAuth and current authority, and import the generated App through Deft's public sideload workflow. Register the actual package digest and reviewed targets, rather than reusing another installation's IDs.

Run the Runtime as one POSIX service with a private local persistent store:

```sh
EMAIL_RUNTIME_CONFIG_FILE=/etc/deft-email/runtime.json node runtime/server.mjs
```

The CLI reads this absolute private JSON file. It binds loopback; HTTPS routing exposes only the reviewed connection and app-data endpoints. Credentials and encryption keys are operator files outside this repository. Runtime installation and channel enrollment are distinct from the human account connection and Send consent.

Then use Email's ordinary connection flow for each account. Check its label and current From address. Grant Read, Send and Organize separately as needed, and review actions in Deft before effects run. Use the [smoke journey](docs/smoke.md) to inspect Refresh, rich mail, drafts/files, actual sending, receipt and Task/source navigation.

## Preview contract

Foreground manual Refresh is the preview contract. Keep the list and reader visible during network waits. Background refresh is a separate explicit metadata permission used for Task/source publication; foreground reads alone do not publish Task projections. Knowledge capture and notifications remain deferred. Unsupported optional UI controls must be hidden by the accepted preview patch; their existing records and journals remain intact. Outlook/IMAP parity, production scale and full mobile layout are outside this release's acceptance scope.

Permission and transport lifetimes are separate. Initial account enrollment stays finite. After reviewed continuation, signed App6 policies can offer **Until revoked** for account, draft-store and background metadata access; an omitted mode or a null expiry alone grants nothing. Reviews, requests and Runtime leases remain finite. Technical renewal checks current membership, scope and custody and does not approve a message; every Send still requires exact-message review. Revocation ends access, and an expired technical session requires supported reissuance. See [setup](docs/setup.md) and [limitations](docs/limitations.md).

## License and provenance

AGPL-3.0-only; original copyright and notices are preserved in [LICENSE](LICENSE) and [NOTICE](NOTICE). Runtime frozen-source provenance is in `runtime/PROVENANCE.json`; verify it before packaging. Third-party dependency licenses remain those in the installed packages. Synthetic fixture certificates and test identities are test material.

The upstream Deft source is [Maneek21/Deft](https://github.com/Maneek21/Deft). This separate repository is [Maneek21/deft-email](https://github.com/Maneek21/deft-email); the candidate is reviewed in [PR 1](https://github.com/Maneek21/deft-email/pull/1). Public candidate artifacts retain their exact historical source offer. Review changes require new build identities before deployment; an open PR is not a published release. Private demo evidence and operator data are maintained outside this repository.
