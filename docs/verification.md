# Author-independent candidate verification

The App `1.9.0-preview.1` and Runtime `0.4.0-preview.1` were extracted from the deterministic source archive into a new directory. Both installed their frozen dependencies there, with no copied dependencies or Deft checkout. The Kit archive is `0.1.0-alpha.33`, SHA256 `c022a3e215766d9730367002f210013ec14b46e01ee6fdf71ed25ca754cb9037` (320250 bytes). Older sealed Kit30/32 archives were rehashed unchanged.

The fresh App build produced package digest `sha256:ac36edeb1fcb78d2f9b9255c1a32cd8c829e31dd9d1f99685b440ad79f60bb4d`; its 23 package, imported-history and Worker UI tests passed. Runtime generic/domain/capture/Host UUID contracts passed 12 tests. Actual SMTP Send and read-only inspection fixtures passed 9 tests, including strict TLS, exact released bytes, real store restart, no replay of uncertainty, custody mismatch and revocation between provider commands. Four actual Gmail Send fixtures passed, including immutable prepare pins, uncertainty across restart and rejected foreign/revoked input. These are local fixtures; none sent provider mail.

Reproduce from a clean source extraction using the locked README install, then:

```sh
node scripts/verify-pins.mjs
node runtime/verify-provenance.mjs
npm run build
npm run test:app
npm run test:ui
pnpm --dir runtime run test:independence
pnpm --dir runtime run test:uuid
```

The provenance audit verifies all 57 retained vendor modules and the preferred source and compiled bytes of Email-owned domain helpers. Historical provenance remains byte-pinned separately. Local tests ran on Node24.14.0; the Linux CI pins supported Node22.23.2. Full hosted CI, rendered acceptance, public source availability and fresh independent sideload/OAuth/delivery/Task proof remain pending for this exact candidate. Earlier demo receipts are historical and do not close these gates.
