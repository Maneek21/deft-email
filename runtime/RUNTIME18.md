# Runtime preview.18: Host-delivered background sessions

After an App upgrade the reviewed bindings move to the new App version, but the Runtime kept only the sessions an operator had written for the old bindings. Drafts, sends, organizing and background refresh stopped, and the only recovery was to issue sessions by hand and copy their tokens into Runtime files.

The Runtime now accepts a `deft.app_runtime_channel_install.v1` request on its authenticated connection endpoint. Host `0.3.0-preview.125` sends it when the owner chooses **Re-establish background access** in Email settings. Each delivered session must be renewable, match a configured registration and use the expected Host paths. The Runtime confirms each session by renewing it with the Host before it stores the session in its encrypted durable store and starts it. The reply lists session ids only. Installed sessions survive restarts and replace operator-file channels for the same registration.

The App stays `1.9.0-preview.14` on Kit alpha.38 and the Runtime on Kit alpha.35. The release bundle is `1.9.0-preview.18`. There is no sync-schema change and no migration.
