# Local nightly auto-compaction patch

Run this command on Logomix:

```sh
~/.local/bin/t3-nightly-patch update-all
```

The command resolves the latest published nightly once, then uses that exact
version on `logomix`, `macmini`, `myhome`, and `macbook`. SSH aliases must be
configured on the machine running the command.

Routine updates are initiated from the MacBook update controls. Scheduled updates
are disabled; do not enable the former `t3-fleet-update.timer` or the older MacBook
`bio.logomix.t3-version-sync` LaunchAgent. See Manual fleet updates from MacBook below.

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
An active-looking subagent record with a completed parent and no active child run
does not block restart; its persisted status is left unchanged. Unknown parents
and independently active child runs continue to block restart.

Builds can finish while agents work. No activation begins until every node is
idle. Each node records its former launchers before the first activation.
Activation is sequential, so a brief version difference exists during the change.
If any activation fails, the coordinator restores every attempted node in reverse
order. Restore errors remain visible and are retried before another update begins.
An interrupted coordinator recovers its recorded transaction on the next attempt.
Live HTTP descriptors must report the selected version at every service and
SSH-managed port. Process counts alone cannot satisfy readiness. Already patched,
live services at the target version are left running.
No database is restored or rewritten by the updater. Restoring older code cannot
undo a database migration; a restore that cannot start remains an explicit failure.

On macOS, an installed Nightly Desktop app is prepared from the matching official
release ZIP, with its published SHA-256 checked. The patch updates both the bundled
backend and web client, preserving the Electron-native dependencies and their
archive unpack flags. An isolated backend must start under that app's own Electron
before GUI validation. GUI validation starts a separate copy through `open`, with
a unique bundle ID and isolated `HOME` and `T3CODE_HOME`. The Electron bundle name
and framework symlinks are preserved, and validation copies register no URL or
document handlers. Main, renderer, and backend processes must exist and the backend
must answer HTTP. The result is tied to the patched archive's SHA-256. The original
app remains untouched during preparation.
Preparation folders and app backups use `.noindex`, and prepared apps are unregistered
from Launch Services after a smoke test, including failed tests. This keeps copies
with the same app name and bundle ID out of normal launch resolution. The repair
command below unregisters older copies and reopens the official installed app.

A modified macOS app requires a local signature. Run `t3-nightly-patch setup-signing`
once on the MacBook to create a persistent code-signing identity in a dedicated
keychain. Its generated password and encrypted key files remain in the private
`~/.local/share/t3-nightly-patch/signing/` directory. The login-keychain password is
not stored. Approve the certificate's code-signing trust once in the MacBook
Terminal when setup prints the command. SSH cannot authorize that trust change.
Setup signs two different binaries with the same identifier and checks that their
designated requirements match and contain no `cdhash`. Subsequent app builds and
GUI probes reuse the same certificate. macOS can still require an initial
permission grant or a grant for a newly accessed folder. The previous ad-hoc build
remains a different identity.

The official developer and keychain-group entitlements cannot be carried by the
local certificate, so the local build
disables the embedded browser's passkey/Touch ID integration. It does not delete
existing passkeys. Desktop activation requires an explicit recorded decision
(`allowDesktopLocalBuild: true` in the patch configuration); without that decision,
activation stops before changing the installed app. The original app is backed up.
Signing validation and operating-system security settings are not disabled.
Headless Electron execution alone is insufficient: the Launch Services GUI probe
must pass before activation. `spctl` assesses distribution/notarization policy and
rejects local ad-hoc builds even when they start successfully; it is not used as a
substitute for the actual GUI probe. The patcher does not add Gatekeeper exceptions
or remove quarantine attributes.

At activation, the selected Nightly app receives SIGTERM and must exit gracefully;
Alpha and other applications are excluded. Desktop nodes activate before CLI nodes
so an old client's reconnect cannot restore an older SSH runtime. The new backend's
PID and HTTP endpoint are checked. Failed startup restores and reopens the former app.
Native mobile apps still require their own rebuild.
The patched Desktop entry point disables the standard updater through
`T3CODE_DISABLE_AUTO_UPDATE`, so a separate Desktop update cannot bypass the fleet
coordinator.

On a node where the SSH-managed server is the sole owner, set `manageBootService`
to `false` and disable the unused boot service. A newer T3 server refuses two
processes opening the same T3 home. The updater retains the SSH-managed port.
Git-free status, activation, and rollback calls do not unlock the login keychain.
An actual Git command prepares the login keychain once per installer process.

The backend patch targets every non-archived, non-deleted T3 conversation using
Claude Code or Codex, excluding provider-native subagents. It sends `/compact`
after 54 minutes for Claude Code and 25 minutes for Codex, measured from the last
user prompt. A five-second scheduler checks deadlines; active work defers the
operation until idle. Only user prompts sent strictly after the current backend worker started are
eligible. Updating or restarting never sweeps historical conversations, even if
their deadlines passed. To arm an existing conversation again, send a new user
prompt after restart. Settled conversations (explicit override or settlement
timestamp) are excluded, as are conversations with a compact message or completed
provider compaction after their latest user prompt. A persisted
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
~/.local/bin/t3-nightly-patch repair-desktop-launch
~/.local/bin/t3-nightly-patch validate-desktop 0.0.46-nightly.20261014.3118
~/.local/bin/t3-nightly-patch setup-signing
```

`apply` prepares a patched runtime without restarting services. `update` is an
alias for the coordinated `update-all`. `activate` remains a low-level local
operation and should not be used for routine updates. `status` shows builds and failures; `inspect`
shows supported launchers and the aggregate active-work count. Fleet results are
saved in `~/.local/share/t3-nightly-patch/fleet-last.json`. The patch source is
captured from the committed feature branch during `install`; after changing the
patch, commit it and run `t3-nightly-patch install` again. Future incompatible
nightlies require adapting the source patch rather than forcing it to apply.

## Manual fleet updates from MacBook

Scheduled deployment is disabled. `auto-update` and `install-auto` refuse to run.
The Logomix `t3-fleet-update.timer` must remain disabled.
The fleet-managed MacBook distribution keeps the official updater disabled and
connects the existing update controls to the patched fleet coordinator instead.
Checking for updates only reads the Nightly release list. Download/install and the
application menu ask for explicit confirmation before preparing and deploying the
selected version to all four computers. The dialog states that this action also
restarts T3; it is not a download-only action.

A confirmed request starts `t3-manual-update.service` on Logomix using systemd-run.
The worker survives the MacBook app restart. All existing reachability, active-work,
signature, GUI validation and rollback checks apply. A blocked or failed request
is reported and never retried on a schedule. The user must request it again.
Result: `~/.local/share/t3-nightly-patch/manual-last.json`; service output:
`journalctl --user -u t3-manual-update.service`.
The only Desktop timer observes an explicitly launched request; it never checks
for a release or starts a deployment. Validation copies disable this bridge.
