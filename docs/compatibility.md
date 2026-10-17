# Compatibility and source identity

The current source candidate is App `1.9.0-preview.13` with packed Kit `0.1.0-alpha.38` and Runtime `0.4.0-preview.15` with Kit `0.1.0-alpha.35`. It requires Host schema120, the generic `menu.v1` governed-document and target-aware resource-refresh contracts, and the matching consent-continuation phase gate. The App nominates Task/Knowledge from the reader menu; Host owns current-source validation, permission review and proof that continuation activation started. Runtime presentation defaults external images per actual account preference without changing source digests. Deploy the compatible Host gate before Runtime15; exact-message Send review remains unchanged. Use exact build and live receipts rather than version labels as acceptance.

App preview.13 retains historical preview.11's exact subject, From, To and optional Cc presentation, uses Kit38 to refresh the displayed account rather than the compose account, and prevents a target-visibility event from being overwritten by an older in-flight mailbox load. Runtime15 retains Runtime14's technical renewal and guarded source reuse while adding bounded local continuation publication after an already-started Host activation. The final Host candidate also bounds sync-claim transactions to eight seconds, reduces repeated authority work and gates status recovery by activation phase. Schema120 alone does not identify those later fixes: require the matching source/image receipts.

App preview.10 introduced Undo that rebinds to the current loaded references for the original successful action and account, retaining its immutable review snapshot. Undo is offered only while every affected message remains in the loaded page; missing targets have no stale-reference fallback. New Reading preferences default to automatic external images, while existing saved Ask choices remain unchanged.

Schema 117 historically rejected `record_stores[].supplemental_effects` with `APP_V7_RECORD_STORE_INVALID` and rolled back activation. Schema 118 adds strict signed-declaration validation; actual PostgreSQL fresh/retained activation regressions and the preceding preview.3 public activation passed without bypassing the guard.

| Boundary | Exact known identity | Status |
|---|---|---|
| Current Host prerequisite | schema120 and matching public Kit38 contracts, including `menu.v1` and target-aware `resource_refresh` | Retains Kit35 compatibility for the existing Runtime and older Apps; exact build/source and live proof required |
| Historical Host database contract | schema118 | Fresh and supported retained-lineage regression proof; preceding preview.3 installed acceptance |
| Historical matched Host source | `25492e34489c0b61144d1ff0e70cbf480a70e27c` | [Complete source offer](https://demo.deft.ing/downloads/deft-host-25492e34-source-offer.html), including retained overlays |
| Current Host review | [Deft PR357](https://github.com/Maneek21/Deft/pull/357) | Require final exact-head required checks, build/source offer and installed proof |
| Current Email source | [Email PR1](https://github.com/Maneek21/deft-email/pull/1), preview.13 / Runtime preview.15 | Build and installed receipts must identify their exact source |
| Current App Kit | `0.1.0-alpha.38` | SHA256 `dbb35ea11e2ce192fed72889aee8ea65764aa16dd93ce0b71f5075e2fb655341`; sealed bytes |
| Current Runtime Kit | `0.1.0-alpha.35` | SHA256 `82c2d5bff2776e423b58647fad0f4a6a6430535f4e60c8146fed737d83f33ad5`; unchanged sealed bytes |
| Historical Kit34 | `0.1.0-alpha.34` | SHA256 `d5b0c498025684e4eae9fafe950846794b39874fac1f3277914e7e3c61bd93ef`; historical sealed bytes unchanged |
| Historical Kit33 | `0.1.0-alpha.33` | SHA256 `c022a3e215766d9730367002f210013ec14b46e01ee6fdf71ed25ca754cb9037`; historical sealed bytes unchanged |

Do not use earlier delivery, Task or fresh-install receipts as acceptance of the new candidate. New package digests require current public review/activation and exact-account reattachment; existing encrypted custody is retained only through supported lifecycle operations.

## Historical recovered baseline

These distinct baseline pins remain reconstruction evidence. Do not use them as the current installation matrix or upgrade Kit labels merely to align their numbers.

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

## Historical preview.1 candidate

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

App/Runtime dependency pins remain Kit30/Kit32. Runtime E5.9 changes only the Host connection UUID validation boundary in four executable modules; valid UUIDv5 reattach sessions now pass, while draft/file UUIDv4 guards remain strict. Its exact artifact/image/source pins are recorded in the release asset manifest and Runtime delta/build receipt. Node22.23.2, frozen dependencies, vendor57 provenance and Kit32 remain unchanged. Prepared Git snapshots and candidate downloads are not a published accepted release or an E6 public sideload pass.

## Historical recovery candidate, not current installed acceptance

| Artifact | Identity | SHA256 |
|---|---|---|
| Email App | 1.8.0-preview.2 | `842788dd3ae3dc2db2dbcba1b2ac66c2927ccf111c2f95c0c50f372bfc555d82` |
| App canonical manifest | package manifest_digest | `92b4d3332c09e42d16f8751513932855d5432cb566158c56b6129b6dc7e57829` |
| Experience bundle | protocol7 / bundlev4 | `d2321eaecee5ce33582781dab3a41a9902b778617699e51b3490e63f5bb127df` |
| Worker bundle | esbuild output | `e1999af34af3e05b158a90e4a10e0005b94f6d434302265321bef91750861163` |

Two App builds reproduced these exact package bytes. App Kit30, Runtime Kit32 and all dependency lock/integrity pins remain unchanged. Runtime `0.3.1-e5.11` preserves the highest recognized account-lineage version when reattach, OAuth upgrade or consent continuation appends receipts. It strictly recovers only a proven legacy version downgrade; inconsistent histories still fail closed. E5.11 also starts action polling immediately, then backs off empty/error claims from500ms to5s without replaying claimed work. Its frozen Runtime source is [commit214f1c1](https://github.com/Maneek21/deft-email/tree/214f1c1d54fb91406c77947233a33bb8b93158bb/runtime). Its source delta is reviewed in Email PR1; package/image/archive identities must be recorded from the new build and source manifest rather than copied from E5.9.

App preview.2 clears previous-account view/action references before a filter switch, removes deferred unread polling and explains the current compose-account distinction. No connection authority or manifest declarations were broadened. A new package still changes grant-bound identities: protocol7 upgrade requires fresh public review/activation and current registrations, followed by exact-account v2 reattachment. The inbox filter does not switch the Host account for compose.

The compatible Host source05 pins above remain historical baseline evidence; the Host and Author Kit PR stack contains additional review changes. Verify the actually deployed Host source/image before installed acceptance. Neither this new App build nor an open PR proves current recipient delivery, rendered UI acceptance or fresh public sideload.

## Current author-independent candidate

App `1.9.0-preview.13` uses sealed Kit `0.1.0-alpha.38`, SHA256 `dbb35ea11e2ce192fed72889aee8ea65764aa16dd93ce0b71f5075e2fb655341`; Runtime `0.4.0-preview.15` retains sealed Kit `0.1.0-alpha.35`, SHA256 `82c2d5bff2776e423b58647fad0f4a6a6430535f4e60c8146fed737d83f33ad5`. Generic Host schema120 plus the matching continuation phase gate is a prerequisite for signed persistent-permission policies, target-aware Refresh and safe interrupted-activation recovery; permission reviews and technical leases remain finite. The candidate requires the generic Host V3 record form, prepared supplemental effect, V2 inspection, V2 source nomination and target-aware `resource_refresh` contracts. It is not compatible with a Host advertising only the historical Email contracts above. Exact App, Runtime and Host source/artifact pins must accompany installed acceptance; historical delivery and fresh-install receipts do not establish acceptance for this candidate.

The [author workflow](author-independence.md) builds from this separate repository without a Host checkout. Operator setup configures published Host assets, provider credentials and reviewed public registrations; it does not patch Host source or SQL.
