# IMAP source authority — one Host check per download (P5-attach, PR5)

`native-imap-reader.mjs` used to call the Host authority check twice per 64 KiB
chunk. A 5 MiB original source is 80 chunks, so its body loop issued roughly 160
Host transactions before returning any bytes. That is the IMAP half of the
attachment timeout.

The change keeps every fence that protects disclosure and changes only *where* the
Host authority call runs:

- **Open:** the existing `value.check()` still runs before `getMailboxLock`.
- **Per chunk:** two local checks replace the Host call — `context.signal`
  (`throwIfAborted`), the reviewed `context.expires_at` deadline, and the open
  client's `authenticated` / `secureConnection` state. Every I/O await remains
  wrapped in `bounded()`, and the abort timer still destroys the stream and client.
- **After the last byte:** the Host `value.check()` runs again, followed by the outer
  check after `withAuthorizedClient` returns. The returned digest is computed only
  after both pass.

Net effect for the same 5 MiB source: zero Host calls inside the chunk loop and a
constant total instead of one that scales with the file. Abort/expiry still stops at
the next chunk boundary.

## Accepted window (review required)

A grant revoked after open is enforced at the next request (the next attachment read,
message read or provider action) rather than mid-stream. Data already delivered to
this process before revocation is not recalled, and a stream that began under a valid
grant can finish. This is the same class of window as any single provider fetch; it is
not a new authorization path, and no new read is started after a failed open or final
check.

If review rejects this trade-off, revert this file to the per-chunk `value.check()`
loop. IMAP attachments above roughly 1 MiB then stay slow, and the attachment latency
target is met only for Gmail/Microsoft.
