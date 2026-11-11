# Kit alpha.43 released artifact adoption

This candidate moves App and Runtime from Kit alpha.42 to the exact Kit alpha.43 archive published by Host141, with minimum Host141/schema `0.3.0-preview.135`. It is assigned bundle `1.9.0-preview.32`, App `1.9.1-preview.13` and Runtime `0.4.0-preview.29`. Historical Kit archives, including alpha.42, stay vendored and pinned unchanged.

- Host release: `v0.3.0-preview.141`
- Released source commit: `0b0c3bb194e6b166253d75e34e80d719ca8d5db8`
- Archive: `deft-app-kit-0.1.0-alpha.43.tgz`
- SHA256: `30caa502db59d10e020c5bb1ca8bb6159901ed65834ce142060e73e829edd513`
- SHA512 integrity: `sha512-WKvIu5SSxaPdaMdhT/VQIDi9IrfYiljeGLojqvgCQ+JLNT+1qU7e796wGTFYm+MFmml18Be+u//x1mfudy/6CA==`

`KIT43-CERTIFICATION.json`, both vendored archives, both locks, immutable pins and compatibility rows identify these same released bytes. `node scripts/verify-kit-release.mjs` verifies the public metadata and download against both local consumers. No candidate or rebuilt substitute can satisfy the publication gate.

Kit43 keeps the Kit42 runtime dependency set (`zod` 4.6.7) and raises the Experience worker source limit from 96 KiB to 112 KiB; the current App worker exceeds the old limit. The generic Host contracts recorded in `release/compatibility.json` (App protocol 7, connection protocol 2, record form 3, resource-sync channel 3) are unchanged between Host138 and Host141.

Deploy Host141 first and keep matched rollback snapshots. Release Email with one Runtime writer and unchanged operator configuration. Domain safety/drift, App/UI, focused Runtime and standalone archive checks must pass before landing.
