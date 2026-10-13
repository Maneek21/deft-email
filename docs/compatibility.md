# Compatibility and source identity

This is the recovered baseline, prior to the accepted preview patch. These are distinct version pins; no coordinated Kit upgrade is required just to align their version labels.

| Component | Baseline | SHA256 |
|---|---|---|
| Email App | 1.7.1-e5.3 | `78c4e4a627f61f276d193391be3f642bfa4561ad4c6b60e8342237f69750dc27` |
| App corresponding source | 1.7.1-e5.3 | `24f23b8bdb7e0064d91c8b4cc24c2f23a438d69e006fb0e73456873c7cbaeee2` |
| App Kit package | 0.1.0-alpha.30 | `8ca1a4924826a2800cc4cec612d0aa729fe8ac20aa07c9025d0e2488f377f6d8` |
| Runtime corresponding source | 0.3.1-e5.8 | `194a091ee70a9edd4d94fb609091fb8f12e48fb916122828cb4cfd0f87c8c2dd` |
| Runtime Kit package | 0.1.0-alpha.32 | `44a4419d6f40320650f20f89d6a99ee3ee0631e613843439fc349849f5a35ddb` |
| Deft Host125 corresponding source | schema117 candidate | `126472de69897b8d35b3103f084150c75fc91cf045912b1d97dad16637526c47` |

Saved publication receipts identify [App baseline source](https://demo.deft.ing/downloads/email-app-1.7.1-e5.3-corresponding-source.tar.gz), [Runtime baseline source](https://demo.deft.ing/downloads/email-runtime-0.3.1-e5.8-corresponding-source.tar.gz) and [Host125 source](https://demo.deft.ing/downloads/deft-source-email-e45-125-current-repair-catalog.tar.gz). Availability must be rechecked at release time. These baseline source offers are not claims that the patched candidate has been published.

The App uses manifest protocol7, experience bundle v4, experience bridge v1 and trusted renderer v2. Runtime requirements are sync-provider channel v3 and mail-provider channel v1. Host125's full release artifacts, exact runtime registration profile and final tested App/experience digests must be recorded with the release. An earlier upstream preview release is not automatically compatible.

The recovered e5.3 manifest uses 36-character account references for Send and Organize. The operator must enroll the actual current accounts and reviewed registrations. Never substitute IDs from a demo install or infer authority from a healthy endpoint.

Public dependency closure includes the sealed Kit tarballs and their Corresponding Source availability. `scripts/verify-pins.mjs` verifies the packaged Kit bytes. Publication must provide an exact source offer for any patched Host/Kit as well as Email; no private artifacts are a supported installation dependency.

Kit30 standalone Corresponding Source is prepared as `deft-app-kit-0.1.0-alpha.30-corresponding-source.tar.gz`, SHA256 `6c3e93e3ce77d8602e5845bc75aa5829cae13d3189a29b838cf70f779b30e853`. Its pinned public-tool build reproduces all 227 distribution files byte for byte; the final release must link this asset beside the sealed Kit30 package. Host125's exact source offer includes Kit32 source. Prepared assets do not establish publication availability.

## Frozen candidate, pending installed acceptance and release publication

| Artifact | Identity | SHA256 |
|---|---|---|
| Email App | 1.8.0-preview.1 | `ae08f1940af6cbebc6d4785b78cc919c4cb8b8b749433951482e0bd1e6533904` |
| App canonical manifest | package manifest_digest | `b1d6fa317e031785f71cb068576b4812be5452caa9ce29cab7e8bb310da1082d` |
| Experience bundle | protocol7 / bundlev4 | `7bd3358b732b8df76ccb2c00750ea676ce7f1e67265c23dd02ff902256475883` |
| Complete Host source05 | preview.16 initializer repair | `da04777d3b9bd66f79f48b4fefc047e84029cab5a767c201c03d0b51deb4f5fc` |
| Host portable configuration | linux/amd64 | `4ef1ff9e856238d5fe1f985017adfdfdc816d9f8ba47d68d14392298a19f9492` |
| Host image archive | source05 candidate | `faf4f6c96d5d520c448fe4ca0e53c250f6b1adb179fb886dbf7e7ca3f5c5bbee` |

The [complete candidate source offer](https://demo.deft.ing/downloads/deft-preview16-candidate-source-offer-05.html) separates full source05 from the matching compiled source04 base and retained overlays. The initializer-only derivative preserves compiled Web/API/SDK layers, adds two initializer files and two tests, and uses an immutable publicly available base archive. Its recipe checks archive, rootfs, runtime config and copied-file hashes without registry credentials. The full source05 archive retains the normal pinned clean-build Dockerfile.

Docker29 may identify an image by OCI index/manifest digest, distinct from its portable configuration digest. The original local candidate index is `sha256:d57891c5167dd688930ede3ea536b526a94942722bf8500c24d08f5545e3a899`; loading the platform archive may change wrapper identity. Verify archive/config/rootfs and use the actual loaded image ID. Existing live Host runtime reporting remains `DEFT_RELEASE_VERSION=0.3.0-preview.117`; image/release metadata is preview.16 and does not change schema authority. Historical SQL and lineage plans are unchanged.

App/Runtime dependency pins remain Kit30/Kit32. Runtime executable modules remain E5.8. Prepared Git snapshots and candidate downloads are not a published accepted release or an E6 public sideload pass.
