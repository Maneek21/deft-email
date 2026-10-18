# Runtime preview.16 packaging repair

The standalone Runtime archive now contains the complete server module graph. Three shared Email tool modules have one canonical definition in `runtime/domain/`; App imports re-export that definition. The operator Dockerfile and its `runtime/` prefix extraction remain compatible.

This repair changes packaging, not provider behavior, authority checks or product features. The release bundle is `1.9.0-preview.14`; the App remains `1.9.0-preview.13` with Kit alpha.38, and the Runtime remains on Kit alpha.35. Host preview.120 is unchanged. The older preview.13 bundle's Runtime artifact omitted the shared modules and fails to start independently.

`npm run test:runtime:artifact` packages the current source, extracts the Runtime without an App checkout, checks all server-reachable relative imports, installs locked production dependencies and starts/stops the actual exported server with synthetic configuration. In a built operator image, `node artifact-startup-smoke.mjs` checks startup, denied unauthenticated HTTP and graceful shutdown without enrollment or provider requests. Run it with no private mounts and `--network none`.
