# Local nightly auto-compaction patch

Run this command on Logomix:

```sh
~/.local/bin/t3-nightly-patch update-all
```

The command resolves the latest published nightly once, then uses that exact
version on `logomix`, `macmini`, `myhome`, and `macbook`. SSH aliases must be
configured on the machine running the command. No update timer is installed.

Every node must be reachable before any build or restart begins. Each node
receives the source patch and installer, builds for its own operating system and
architecture, runs the focused feature tests, and smoke-tests an isolated server.
The official release archive supplies runtime dependencies and must pass its
published SHA-256 check. A source conflict stops the command before activation.
Successful builds are reused on subsequent attempts.

After all builds finish, the command checks for active runs, pending runtime
requests, and active subagents again. Busy nodes prevent activation. During each
node's activation, systemd or launchd stops the boot service, and recorded
SSH-managed server PIDs receive SIGTERM. The command waits for graceful shutdown
before replacing an active runtime. It preserves existing SSH ports and updates
their pinned launchers. Server processes must report the selected runtime version.

The fleet update is sequential, not an atomic transaction across machines. If a
later activation fails, earlier nodes can already be updated. The fleet report
records the last successful phase per node. A failed local activation attempts
to restart former launchers; rollback errors remain visible. No database is
restored or rewritten by the updater.

On macOS, an installed Nightly Desktop app is prepared from the matching official
release ZIP, with its published SHA-256 checked. The patch updates both the bundled
backend and web client, preserving the Electron-native dependencies and their
archive unpack flags. An isolated backend must start under that app's own Electron
before the copy can be activated. The original app remains untouched during preparation.

A modified macOS app requires a local ad-hoc signature. The official developer and
keychain-group entitlements cannot be carried by that signature, so the local build
disables the embedded browser's passkey/Touch ID integration. It does not delete
existing passkeys. Desktop activation requires an explicit recorded decision
(`allowDesktopLocalBuild: true` in the patch configuration); without that decision,
activation stops before changing the installed app. The original app is backed up.
Signing validation and operating-system security settings are not disabled.

At activation, the selected Nightly app receives SIGTERM and must exit gracefully;
Alpha and other applications are excluded. Desktop nodes activate before CLI nodes
so an old client's reconnect cannot restore an older SSH runtime. The new backend's
PID and HTTP endpoint are checked. Failed startup restores and reopens the former app.
Native mobile apps still require their own rebuild.

The backend patch targets every non-archived, non-deleted T3 conversation using
Claude Code or Codex, excluding provider-native subagents. It sends `/compact`
after 54 minutes for Claude Code and 25 minutes for Codex, measured from the last
user prompt. A five-second scheduler checks deadlines; active work defers the
operation until idle. Existing old conversations are included. A persisted
maintenance message prevents repeating the attempt until a new user prompt.
The patched web and mobile source shows a countdown below ten minutes.
These times are user-selected policy values, not a guarantee of cache retention
or billing discounts.

Other commands:

```sh
~/.local/bin/t3-nightly-patch update-all 0.0.46-nightly.20261014.3118
~/.local/bin/t3-nightly-patch apply
~/.local/bin/t3-nightly-patch update
~/.local/bin/t3-nightly-patch status
~/.local/bin/t3-nightly-patch inspect
```

`apply` prepares a patched runtime without restarting services. `update` prepares
and activates only the local node. `status` shows builds and failures; `inspect`
shows supported launchers and the aggregate active-work count. Fleet results are
saved in `~/.local/share/t3-nightly-patch/fleet-last.json`. The patch source is
captured from the committed feature branch during `install`; after changing the
patch, commit it and run `t3-nightly-patch install` again. Future incompatible
nightlies require adapting the source patch rather than forcing it to apply.
