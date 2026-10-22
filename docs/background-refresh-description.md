# Email background-refresh description

The current Email28 set requires Host136 and the immutable Host134 Kit42. Background refresh defaults to **Until revoked** and explains how mailbox metadata supports Tasks/Knowledge. Trusted compatible updates can keep that reviewed approval; a dated permission still expires without automatic renewal. See [current setup and controls](setup.md#connect-once-operation).

The preview.20 details below are historical: they record the introduction of the App-owned description with Host127/Kit39. They are not the current compatibility matrix.

Email now owns the explanation displayed in its background-refresh review:

> Keep mailbox metadata current while this app is closed. Turn this on to create Tasks or Knowledge from mail: it is how the app shares messages with Deft.

`app/build.mjs` declares this as `background_refresh_description` in the experience bundle. Host preview.127 is the minimum: older Hosts reject this optional field. The source compatibility template records that minimum; it is independent of schema120, which is unchanged.

The App uses sealed Author Kit alpha.39, built and packed from `packages/app-kit` in the public Host preview.127 source. `scripts/verify-pins.mjs`, the npm lockfile, and `release/compatibility.json` pin its exact bytes. Alpha.38 remains retained as a historical input, and the Runtime keeps its unchanged alpha.35 package and source provenance. The Host source tag and source archive allow reconstruction of the new Kit; no local Host checkout is required to build Email from this repository.

Validation includes a fresh App build, package verification of the exact description and Host minimum, App/UI tests, Runtime tests, and provenance checks. Bundle preview.20 allocates App 1.9.1-preview.1 and retains unchanged Runtime preview.18. The detached compatibility record resolves published Host127 assets and the exact release commit. Preview.18 remains available for rollback.
