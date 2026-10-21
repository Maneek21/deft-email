# Kit alpha.42 released artifact adoption

Email27 prepares App1.9.1-preview.8 and Runtime0.4.0-preview.25, minimum Host134/schema131. Both use exact published Host134 release-flow bytes, with their own Email author/runtime domain modules. Historical artifacts are unchanged.

- Host release: `v0.3.0-preview.134`
- Released source commit: `b956d9bad093b6b705b88980ff68d01806beff7a`
- Archive: `deft-app-kit-0.1.0-alpha.42.tgz`
- SHA256: `efbeb9204b6c6a5ba997d67dd6ba995d30e0883aa7477731eee005270e866e06`
- SHA512 integrity: `sha512-VQjgvuF/1zBbbiPtwyOGLJnYkmrO62ql1TdTwQIte6CTc1pVlDFD9p7dKf0L/WqOrnOZihWQA4a6bZ9RRFWqtQ==`

`KIT42-CERTIFICATION.json`, both archives, both locks, immutable pins and compatibility rows identify these same released bytes. `node scripts/verify-kit-release.mjs` verifies the public metadata/download and both local consumers. No candidate or rebuilt substitute can satisfy the publication gate.

Current Email26 negative-status reservation recovery, retained HTTP/authority callback limits and bounded observation publication remain unchanged apart from clean Kit imports. Domain safety/drift, App/UI, focused Runtime and standalone archive checks must all pass before landing.

Deploy Host134 first and retain Host133 with matched rollback snapshots. Release/deploy Email27 with one Runtime writer and unchanged operator configuration. For the trusted installation, prove system carry-forward, zero owner permission/recovery calls, fresh renewal ACKs and automatic sync/checkpoint progress. No Send. Retarget and refresh Deft #385 on final master and land it last.
