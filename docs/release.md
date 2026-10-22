# Developer-preview release procedure

This release demonstrates an independently built connected App using public Author Kit contracts. It does not certify a production mail service or add roadmap features. [The compatibility manifest](https://github.com/Maneek21/deft-email/releases/download/v1.9.0-preview.31/compatibility.json) is authoritative for the final integrated source and artifacts; [limitations](limitations.md) must accompany the prerelease.

## Freeze and integrate

The preview.29 candidate pairs App10 with Runtime27 and retains minimum Host136 because no new wire contract is required. Exact green CI and the coordinated Host137 acceptance step must precede release or deployment. Kit42 remains the exact immutable Host134 artifact; do not relabel its producer. Retain matched backups and the single-writer Runtime rule, then verify a zero-step trusted upgrade and visible read-only Reply opening without creating a draft. No Send is authorized. Refresh protected checks after base changes; do not bypass security or provenance checks.

Use the final integrated commits, not the pre-merge demo commits, as release source. Keep generated outputs, credentials, mailbox data, custody and private operational evidence outside Git. Record which historical evidence remains valid because the relevant executable artifacts are unchanged.

## Build and identify artifacts

1. Use the existing Host release workflow and its signing/provenance process. Build the explicitly supported Apps-enabled developer-preview image with the Apps, resource-sync and attachment-broker browser gates. Verify those features in the compiled bundle. Unrelated stable-release defaults remain separate.
2. Build Email in a clean directory from public source and the pinned Kit tarballs using [README commands](../README.md#build-independently). Verify provenance and focused CI. Build the App twice and compare package bytes when establishing the release package identity.
3. Record the App package SHA256, canonical manifest digest, experience digest and worker hash from the generated artifacts. The root version identifies the release bundle; the App build reads `app/package.json`. A Runtime-only packaging repair can advance the bundle and Runtime while preserving the exact App version and package bytes. Record each version separately in compatibility metadata. App and Runtime keep their independently versioned Kit pins.
4. Run `npm run package:source` after source freeze. Retain `dist/source-manifest.json`, `dist/email-<version>-source.tar.gz` and `dist/runtime-artifact.tgz`. Runtime archive entries have one `runtime/` prefix for the documented operator Docker recipe. The deterministic source packager needs Python3's standard library; App and Runtime use Node.
5. Publish the exact Host134 Kit42 tarball, its release metadata and corresponding source; retain unchanged historical Kit packages and source offers. Public tarball downloads are sufficient for this preview; npm publishing is not required.
6. Fill the authoritative compatibility record with final version/commit/digest/schema/contracts and public URLs for every required artifact. Publish the exact manifest and detached checksum file with the prerelease. Do not place an archive's own checksum inside that archive or relabel older assets as a new build.

## Bounded final acceptance

Use [the acceptance journey](smoke.md) in a clean consumer environment following the public instructions. Reuse valid existing evidence and close only release-critical gaps: available Apps; standalone Email build; Gmail read/HTML/images; attachment draft save/reopen; one reviewed controlled Send with independent recipient receipt; Task and source return; state across restart; and the existing Email-only update against an unchanged Host. Observe backend health throughout.

Installation failures, authority/isolation defects, data loss and duplicate-send risks block publication. Record slow Refresh and other accepted residuals. Broad parity tests, cosmetic work, repeated latency campaigns and video production are outside this release pass.

## Publish and verify

Create a prerelease/developer-preview release only after required integration and security checks pass. Use immutable versioned download names and preserve earlier releases and source offers. Include license notices and complete corresponding source for distributed Email, Runtime, Kit and Host artifacts.

Fetch the public release manifest and downloads into an empty consumer directory. Check their hashes, source references and documented install/build commands without private artifacts or a Deft checkout. Verify the signed Host provenance using the Host release instructions and confirm the actual loaded artifact matches the compatibility record. Mark the publication complete only after public downloads and the installation path are verified.

The final handoff identifies merged PRs/commits, public Host/Email/Kit links, supported compatibility, acceptance and residuals, plus README/setup/roadmap links. An open PR, successful packaging job or prepared release asset alone is not a shipped preview.
