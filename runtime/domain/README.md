# Email author/runtime library

`source/*.ts` is maintained by deft-email. `*.mjs` is the portable generated output
used by the Runtime and available to the app author build. These modules own
mailbox parsing/formatting, compose and signature bodies, CID/file references and
fixed raster profiles. They do not import these behaviors from Author Kit.

Run `npm run build:domain` at the repository root to compile with the app's pinned
esbuild, and `npm run test:domain` for the XSS, URL, malformed address, rich-text,
CID, image-limit and raster parity corpus. `PROVENANCE.json` records the original
upstream sources and hashes plus the current app-owned source/output hashes.

Host independently checks its generic rich-text/URI/image contract. App parser
acceptance never grants Host trust, file custody or provider authority.
