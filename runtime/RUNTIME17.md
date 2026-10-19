# Runtime preview.17: Task sources for searched messages

Messages returned by search or opened in a conversation were rendered in Email but never published to the Host as exact integration sources. Creating a Task from such a message failed at audience review with HTTP 403 until a later native scan happened to publish it.

The Runtime now publishes authorized foreground query and conversation results as explicit `partial_observation` intent through the existing pinned, normalized publication ring. Partial publications don't move the native cursor, add state updates, infer tombstones, claim complete coverage or grant authority. Replaying the same pending result is retained, and duplicate adjacent partial observations don't allocate another ring page. Bounded retention and overflow/rebaseline behavior are unchanged. There is no public sync-schema change and no migration.

App preview.14 bounds draft opening so Compose no longer waits indefinitely. The release bundle is `1.9.0-preview.17`; the App stays on Kit alpha.38 and the Runtime on Kit alpha.35. It pairs with Host `0.3.0-preview.123`.
