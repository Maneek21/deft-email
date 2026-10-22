# Authority timing

The Runtime emits `email_authority_timing_summary` after 64 callback attempts
in a route category, or on that category's next callback after 60 seconds.
Categories are fixed: `data`, `connection`, `resource`, `integration`, `other`.
Each batch is separate and contains at most 64 samples. No request IDs,
organization IDs, URLs, tokens, request bodies, or provider content are retained.

`calls`, `completed`, `denied`, and `failed` count callback attempts and outcomes.
`dispatched` counts verified HTTP dispatches. The private data client records
actual fetch dispatch; a public Kit call verifies dispatch through its validated
result or an HTTP status. An unsuccessful public Kit call without HTTP evidence
does not increment that count. `completed_under_150_ms` counts successful calls
strictly below the latency target.

`elapsed_ms`, `queue_ms`, and `http_ms` contain the exact nearest-rank p50/p95,
maximum, and total for successful callbacks in that batch, rounded to hundredths
of a millisecond. An empty successful batch has null percentiles. Queue time is
the Runtime transport or observation admission queue. HTTP time includes bounded
body reading and the client's response validation. These are client timings,
including local scheduling, rather than Host handler measurements. Batch
percentiles must not be averaged to produce an overall percentile.

`createAuthorityClient({onTiming})` and the observation runner's
`onAuthorityTiming` option provide each content-free numeric sample for a
controlled diagnostic or fixture. Sink failures, including rejected promises,
are isolated from authority results. All provider, commit, and disclosure guards
run as before; a completed timing sample is never reusable authority.
