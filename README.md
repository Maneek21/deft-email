> Optional Note6 candidate: App 1.9.0-preview.6 / Runtime 0.4.0-preview.4, based on corrected Preview5 source 36fa8f66. The base-status text below is inherited; live Note6 upgrade acceptance remains pending. See docs/independence-upgrade.md.

# Email developer preview for Deft

Email is a separately built sideloaded App with an external Email Runtime. The App uses Deft's generic trusted renderer; the Runtime owns provider custody, mailbox state, MIME, drafts, files and reviewed sending. Deft supplies account authority, native records, reviewed actions and Task/source navigation.

This checkout is a reviewed source candidate, with final live acceptance pending: App `1.9.0-preview.5`, Runtime `0.4.0-preview.3`, both using Kit `0.1.0-alpha.33`. It declares generic record form v3, sealed supplemental effects and capture nomination v2. Mailbox grammar, MIME, provider custody, Sent-copy semantics and quoted-history normalization are Email-owned modules. Historical preview.2/E5.11 and sealed Kit30/32 artifacts remain evidence for their exact old versions; they do not prove acceptance of this new candidate. See [compatibility](docs/compatibility.md).

## Build from this repository

Use Node >=22.13.0, npm 11.9.0 and pnpm 10.33.0. The current local toolchain is Node24.14.0; production Node22 remains the supported baseline. The packed Kit33 dependency is included with fixed lock integrity; older sealed packages are preserved. No Deft developer checkout or copied `node_modules` is required. The operator separately supplies a compatible published Host image, HTTPS/OAuth client and private registration/configuration files. App development requires no Host source patch, SQL change or built-in Email adapter.

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

Schema 118 corrected the earlier supplemental-effect database mismatch and accepted the preceding App preview.3 through the public upgrade path. That installed proof does not establish acceptance of this checkout. Current rebuilt-artifact, live functional, fresh independent installation and Email-only upgrade gates remain pending; see [compatibility](docs/compatibility.md). First obtain a Host whose public and database contracts both support this package; use its exact verified source/image/schema pins. A stable release number alone does not establish these preview contracts. Follow [setup](docs/setup.md) to register the Runtime, configure OAuth and current authority, and import the generated App through Deft's public sideload workflow. Register the actual package digest and reviewed targets, rather than reusing another installation's IDs.

Run the Runtime as one POSIX service with a private local persistent store:

```sh
EMAIL_RUNTIME_CONFIG_FILE=/etc/deft-email/runtime.json node runtime/server.mjs
```

The CLI reads this absolute private JSON file. It binds loopback; HTTPS routing exposes only the reviewed connection and app-data endpoints. Credentials and encryption keys are operator files outside this repository. Runtime installation and channel enrollment are distinct from the human account connection and Send consent.

Then use Email's ordinary connection flow for each account. Check its label and current From address. Grant Read, Send and Organize separately as needed, and review actions in Deft before effects run. Use the [smoke journey](docs/smoke.md) to inspect Refresh, rich mail, drafts/files, actual sending, receipt and Task/source navigation.

## Preview contract

Foreground manual Refresh is the preview contract. Keep the list and reader visible during network waits. Automatic observation, Knowledge capture and notifications are deferred. Unsupported optional UI controls must be hidden by the accepted preview patch; their existing records and journals remain intact. Outlook/IMAP parity, production scale and full mobile layout are outside this release's acceptance scope.

Authority is finite. Exact current session, consent and renewal ceilings govern each account and action. Technical renewal continues the same explicitly opted-in Runtime channel only within its issued ceiling; it grants no new human consent. Expiry/revocation requires supported re-enrollment or reconnection. See [setup](docs/setup.md) and [limitations](docs/limitations.md).

## License and provenance

AGPL-3.0-only; original copyright and notices are preserved in [LICENSE](LICENSE) and [NOTICE](NOTICE). Runtime frozen-source provenance is in `runtime/PROVENANCE.json`; verify it before packaging. Third-party dependency licenses remain those in the installed packages. Synthetic fixture certificates and test identities are test material.

The upstream Deft source is [Maneek21/Deft](https://github.com/Maneek21/Deft). This separate repository is [Maneek21/deft-email](https://github.com/Maneek21/deft-email); the candidate is reviewed in [PR 1](https://github.com/Maneek21/deft-email/pull/1). Public candidate artifacts retain their exact historical source offer. Review changes require new build identities before deployment; an open PR is not a published release. Private demo evidence and operator data are maintained outside this repository.
