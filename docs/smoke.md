# Bounded developer-preview acceptance

Use controlled synthetic mail and the established test accounts. Keep credentials, unrelated mailbox contents and private evidence out of public artifacts. Record the exact compatibility set before starting, use one Runtime writer, and preserve existing unknown-send journals.

Reuse existing evidence where it applies to the exact artifacts. Rerun only changed or missing release-critical checks. The release does not require video, a long screenshot tour, repeated latency cycles or broad feature retesting already covered by CI.

| Check | Required observable result |
|---|---|
| Public consumer inputs | From an empty directory, download and checksum-verify the manifest, Host assets, Email source/package/Runtime and Kit tarballs using public URLs. No private artifacts are needed. |
| Apps-enabled Host | The actual release browser bundle exposes Apps and required resource-sync/attachment features. Runtime environment flags alone are insufficient. Host ready/schema/source identity matches the manifest. |
| Independent Email build | Locked App/Runtime installation, provenance and App build succeed without a Deft checkout or copied dependencies. The generated package matches its recorded digest. |
| Gmail and reading | Connect through supported OAuth/current authority; confirm account identity, read a message and render one representative HTML email with external images. Respect a saved Ask preference or explicit Host policy. |
| Draft and file | Create a controlled attachment draft, save, close and reopen it; verify its values and attachment identity. |
| Reviewed Send | Confirm current From/recipients/files, perform one ordinary exact-message review and Send, and independently verify the recipient message and attachment. Never retry an unknown prior Send as a new test. |
| Task and source | With the reviewed publication lane ready, create a Task from the reader, inspect native details and follow its original Email source backlink. |
| Restart | Gracefully restart the sole Runtime with its same private store/key and verify retained draft/file state and healthy consumers. |
| Email-only update | Use the existing private-note upgrade example; retain a pre-upgrade draft and inspect the new form while Host source/image/schema stays unchanged. |
| Health | Observe database-pool headroom, authority failures, worker readiness, restarts and OOMs during the journey; identify and resolve release-critical failures. |

Task/Knowledge nomination and publication are distinct from foreground mailbox access. Follow [setup](setup.md#task-and-knowledge-integration) before the Task/source check. Knowledge behavior beyond valid retained evidence is disclosed rather than claimed from a mailbox read.

Record pass/fail/unverified, artifact identities, independent recipient verification and the scope of reused receipts. Keep 2–3 decisive screenshots where helpful; no video is required. Publish known slow Refresh and other accepted residuals with the result. The final [release handoff](release.md#publish-and-verify) is complete only after the published downloads and documented installation path have been verified.
