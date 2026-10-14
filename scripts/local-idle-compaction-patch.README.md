# Local nightly auto-compaction patch

Run this command on Logomix after updating the Desktop client:

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

CLI runtime patching does not modify an Electron Desktop app's bundled backend
or frontend, or rebuild a native mobile app. A running Desktop backend blocks
activation. A Desktop client reconnecting with an older pinned server version
can rewrite an SSH launcher, so update that client before running this command.

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
