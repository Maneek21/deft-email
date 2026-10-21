# Kit alpha.42 preparation (not published)

This branch prepares Email24 (App 1.9.1-preview.5, Runtime
0.4.0-preview.22) on I1's Email23 transport behavior. Both consumers use the
clean Kit alpha.42 entry points and deft-email's own domain library. The
supported minimum becomes Host134, schema131. Previous release artifacts
and their Kit39/Kit35 archives remain unchanged.

The checked-in alpha.42 archives are local certification candidates built
from the source commit in `KIT42-CERTIFICATION.json`. They are not published
Host artifacts. The separate **Published Kit alpha.42** CI job deliberately
fails closed until publication and exact artifact adoption. The ordinary
preview checks still exercise the candidate's complete App/Runtime path.

## Remaining publication gate

1. First let I1 finish Host133 and Email23 (#17); preserve that socket-budget fix.
   Merge Deft #393, #394 and #407 only after current required CI and a separate
   landing instruction. Release Host 0.3.0-preview.134 through its normal flow.
   That flow must emit `deft-app-kit-0.1.0-alpha.42.tgz`,
   `author-kit-release.json`, and their release checksums.
2. Download and verify those public Host134 release assets. The metadata must
   identify the exact released source commit, Kit version, filename, SHA-256
   and SHA-512 integrity. Do not rebuild an archive and call it published.
3. Replace the two candidate archives in `app/` and `runtime/` with those exact
   released bytes. Keep all historical archives intact.
4. Copy the released `source_commit`, `sha256` and `integrity` into
   `KIT42-CERTIFICATION.json`; set `artifact_origin` to
   `Host release-flow artifact`. Update both new immutable pins in
   `scripts/verify-pins.mjs` and both Kit rows in `release/compatibility.json`.
5. Regenerate `app/package-lock.json` and `runtime/pnpm-lock.yaml` for the
   released archives, keeping the pinned public dependency versions and CRLF.
   Reinstall with the frozen locks.
6. Run `npm run verify:provenance`, `npm run test:domain`, `npm run build`,
   App/UI checks, focused Runtime/reattachment checks, and
   `npm run test:runtime:artifact`. Run `node scripts/verify-kit-release.mjs`;
   it verifies both local archives and the downloaded archive against the
   exact release metadata. Obtain green preview and publication CI.
7. Only then land this PR under a separate instruction and coordinate the
   Email24 release. Land Deft #385 last, with its final exact exception review.

If another release owner allocates Host134 or Email24 before these branches
land, allocate new unused release identities and update all expected release
pins together. Never replace an existing release or sealed Kit version.
