# Foreground sync page — 0.4.0-preview.28 (P5-sync)

One manual Refresh used to do two Host requests and several provider waves: a
synchronous `resource_refresh` (Gmail list plus every metadata row) followed by a
cache-only `resource_list` of what refresh had just written. This change keeps the
same authority, consent and session fences and cuts the page in four places:

1. A refresh that arrives while a local observation holds
   `email.runtime.session.<id>` returns only the local cache stamp. It runs after the
   opening Host admission and the same `assertNoCredentialRepair` fence, performs no
   provider I/O and discloses no rows (`freshness.provider_observed = false`). The app
   keeps the loaded rows, says `Syncing…` and re-polls once after 3 s.
2. Foreground hydration is bounded to `nativePageHydrationLimit: 10`, one full Gmail
   metadata batch. Ten real rows are shown instead of a first wave of five.
3. The app paints the cached rows before awaiting the network.
4. `resource_refresh` returns the committed page (`items`, `next_cursor`, `freshness`).
   The app uses it and skips the follow-up `resource_list`. An older runtime without
   page fields still gets the one fallback list.

No file under `runtime/vendor/**` changed; `node verify-provenance.mjs` still passes.
The busy fast path cannot return items and cannot run without the signed opening
authority. The only new durable-store method is the read-only `isHeld(id)` probe.

## Fixture measurements

Harness: `node scripts/perf-sync-page.mjs --authority-ms <A> --runs <n> --mode both`.
Fixture Host authority latency is `A`; the provider is a local two-account Gmail
fixture. `provider_calls` counts Gmail list and metadata GETs per page; the one-time
account profile/checkpoint GET is setup, not page work. `runtime_authority_callbacks`
counts provider-adjacent Host waves plus final disclosure; `host_fences` is the total
number of `assertCurrent` dispatches, including opening, entry and commit fences. Busy
mode holds the real durable session lock while measuring and uses a 10 ms admission so
the number reports queue avoidance rather than the configured page authority latency.

| Mode | Before | After |
|---|---|---|
| A = 450 ms, cold p50 | 7,946 ms (2 requests, 26 provider, 14 fences) | 3,980 ms (1 request, 11 provider, 9 fences) |
| A = 450 ms, cold p95 | 7,946 ms (1 run) | 5,423 ms (5 runs) |
| A = 900 ms, cold p50 | 14,235 ms (2 requests, 26 provider, 14 fences) | 7,039 ms (5 runs) |
| A = 900 ms, cold p95 | 14,235 ms (1 run) | 9,118 ms (5 runs) |
| A = 900 ms, warm p95 | not measured | 6,899 ms (5 runs) |
| A = 900 ms, busy (lock held) | up to the observation lifetime (FIFO queue) | 30 ms p95 |
| Provider calls per page | 26 | 11 cold, 0 on a cache-only warm page |
| Provider-adjacent Host waves | 5 | 3 cold, 2 warm, 0 busy |
| Total Host fences | 14 | 9 cold, 7 warm, 1 busy |
| Browser requests per Refresh | 2 | 1 |

The before rows were measured from the same harness on the commit before the runtime
change (detached worktree at `fecb122`), not inferred from averages. Run counts differ
because the before run was a single cold sample; the after figures use five runs and
nearest-rank p95. `--authority-ms 900 --runs 5 --mode both` exits 0 with cold
`elapsed_ms < 10,000`, warm `< 8,000`, busy `< 500`, `provider_calls <= 11` and
provider-adjacent callbacks `<= 4`. `--authority-ms 450` gives cold p95 5,423 ms
(`< 6,000`).

The unbounded control is kept visible in `sync-page-latency.test.mjs`: the same Gmail
fixture with `nativePageHydrationLimit: 25` still performs 26 page calls and at least
five authority checks, versus 11 calls for the bounded page.

## Live mode

`node scripts/perf-sync-page.mjs --live https://demo.deft.ing --cookie-file <file>
--installation <uuid> --request-file <captured.json>` replays captured request bodies
and prints only request ids, counts, status and timings. It never prints bodies, cookies,
tokens or message data. No live capture was taken for this change; the fixture rows above
are the release evidence and live mode remains a PR evidence step, not a CI gate.
