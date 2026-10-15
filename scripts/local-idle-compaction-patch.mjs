#!/usr/bin/env node
/* oxlint-disable t3code/no-global-process-runtime -- This standalone installer is an imperative CLI boundary, not an Effect service. */
/** Rebuild the local idle-compaction patch against installed or upcoming nightlies. */
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import {
  activateLocal,
  bootstrapExport,
  exportPatch,
  inspectLocal,
  runFleet,
  snapshotFleetNode,
  rollbackFleetNode,
} from "./local-idle-compaction-fleet.mjs";
import {
  prepareDesktop,
  repairDesktopLaunch,
  validateDesktopGui,
} from "./local-idle-compaction-desktop.mjs";

let repo = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const base = "v0.0.46-nightly.20261012.3010";
const state =
  process.env.T3_PATCH_STATE_DIR ??
  NodePath.join(NodeOS.homedir(), ".local/share/t3-nightly-patch");
const home = process.env.T3CODE_HOME ?? NodePath.join(NodeOS.homedir(), ".t3");
const versions = NodePath.join(home, "runtime/versions");
const markerName = ".idle-compaction-patch.json";
const configFile = NodePath.join(state, "config.json");
const versionPattern = /^0\.0\.\d+-nightly\.\d{8}\.\d+$/;

async function exists(path) {
  return NodeFSP.access(path).then(
    () => true,
    () => false,
  );
}
async function json(path) {
  return JSON.parse(await NodeFSP.readFile(path, "utf8"));
}
async function writeJson(path, value) {
  await NodeFSP.writeFile(path, JSON.stringify(value, null, 2) + "\n");
}
async function runningVersion(version) {
  const executable = NodePath.join(versions, version, "t3");
  if (NodeOS.platform() === "darwin") {
    const processes = await run("ps", ["-axo", "command="], { capture: true });
    return processes.split("\n").some((line) => line.startsWith(`${executable} `));
  }
  for (const pid of await NodeFSP.readdir("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    if ((await NodeFSP.readlink(`/proc/${pid}/exe`).catch(() => "")) === executable) return true;
  }
  return false;
}
async function publish(version, staging, patchCommit, transaction = null) {
  const target = NodePath.join(versions, version);
  if (await runningVersion(version)) {
    await writeJson(NodePath.join(state, `pending-${version}.json`), {
      version,
      staging,
      patchCommit,
    });
    console.log(`${version}: build ready; installation waits until this runtime is stopped.`);
    return;
  }
  let backup = null;
  if (await exists(target)) {
    backup = NodePath.join(home, "runtime/patch-backups", `${version}-${Date.now()}`);
    await NodeFSP.mkdir(NodePath.dirname(backup), { recursive: true });
    await NodeFSP.rename(target, backup);
  }
  try {
    await NodeFSP.rename(staging, target);
  } catch (error) {
    if (backup) await NodeFSP.rename(backup, target);
    throw error;
  }
  await writeJson(NodePath.join(state, "last-success.json"), {
    version,
    patchCommit,
    backup,
    completedAt: new Date().toISOString(),
    transaction,
  });
  await writeJson(NodePath.join(state, "last-error.json"), null);
  console.log(`${version}: patch installed; the normal T3 updater can use this prepared runtime.`);
}
async function run(command, args, options = {}) {
  const child = NodeChildProcess.spawn(command, args, {
    cwd: options.cwd ?? repo,
    env: {
      ...process.env,
      ...(NodeOS.platform() === "linux"
        ? {
            XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`,
            DBUS_SESSION_BUS_ADDRESS:
              process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=/run/user/${process.getuid()}/bus`,
          }
        : {}),
      ...options.env,
    },
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  let output = "";
  if (options.capture)
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
  await new Promise((done, fail) => {
    child.on("error", fail);
    child.on("exit", (code, signal) =>
      code === 0 ? done() : fail(new Error(`${command} exited ${code ?? signal}`)),
    );
  });
  return output.trim();
}
async function api(path) {
  const response = await fetch(`https://api.github.com/repos/pingdotgg/t3code/${path}`);
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return response.json();
}
async function latestRelease() {
  const releases = await api("releases?per_page=50");
  const release = releases
    .filter((item) => !item.draft && versionPattern.test(item.tag_name.slice(1)))
    .sort((a, b) => b.published_at.localeCompare(a.published_at))[0];
  if (!release) throw new Error("No published nightly release found");
  return release;
}
async function installedVersion() {
  const names = await NodeFSP.readdir(versions);
  const nightly = names
    .filter((name) => versionPattern.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (!nightly.length) throw new Error("No installed nightly found");
  return nightly.at(-1);
}
async function settings() {
  if (!(await exists(configFile))) throw new Error("Run t3-nightly-patch install first");
  const config = await json(configFile);
  if (!/^[a-f0-9]{40}$/.test(config.patchCommit)) throw new Error("Invalid patch commit");
  return config;
}
async function featureHash(commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid feature commit");
  const patch = await run("git", ["diff", "--binary", base, commit, "--", "apps", "packages"], {
    capture: true,
  });
  return NodeCrypto.createHash("sha256").update(patch).digest("hex");
}
async function samePatch(record, config) {
  if (config.patchFile && !record.featureHash && record.patchCommit !== config.patchCommit)
    return false;
  return (
    record.patchCommit === config.patchCommit ||
    (record.featureHash ?? (await featureHash(record.patchCommit))) ===
      (config.featureHash ?? (await featureHash(config.patchCommit)))
  );
}
async function prepare(version, release) {
  if (!versionPattern.test(version)) throw new Error("Expected an exact nightly version");
  const config = await settings();
  const target = NodePath.join(versions, version);
  const marker = NodePath.join(target, markerName);
  if ((await exists(marker)) && (await samePatch(await json(marker), config))) {
    console.log(`${version}: patch already installed`);
    return;
  }
  const pendingFile = NodePath.join(state, `pending-${version}.json`);
  if (await exists(pendingFile)) {
    const pending = await json(pendingFile);
    if (
      (await samePatch(pending, config)) &&
      (await exists(NodePath.join(pending.staging, markerName)))
    ) {
      await publish(version, pending.staging, config.patchCommit);
      return;
    }
  }
  const work = NodePath.join(
    config.buildRoot ?? NodePath.join(state, "builds"),
    `${version}-${Date.now()}`,
  );
  const source = NodePath.join(work, "source");
  const staging = NodePath.join(versions, `.idle-patch-${version}-${process.pid}`);
  await NodeFSP.mkdir(source, { recursive: true });
  await writeJson(NodePath.join(state, "progress.json"), {
    version,
    work,
    startedAt: new Date().toISOString(),
  });
  console.log(`Building ${version}; source and logs: ${work}`);
  await run("git", ["fetch", "--depth=1", "origin", `refs/tags/v${version}:refs/tags/v${version}`]);
  const archive = NodePath.join(work, "source.tar");
  await run("git", ["archive", `v${version}`, "-o", archive]);
  await run("tar", ["-xf", archive, "-C", source]);
  const patch = config.patchFile
    ? (await NodeFSP.readFile(config.patchFile, "utf8")).trim()
    : await run("git", ["diff", "--binary", base, config.patchCommit, "--", "apps", "packages"], {
        capture: true,
      });
  if (!patch) throw new Error("Patch commit has no feature changes");
  const patchFile = NodePath.join(work, "idle-compaction.patch");
  await NodeFSP.writeFile(patchFile, patch + "\n");
  // A failed check leaves the official runtime and launch configuration intact.
  await run("git", ["apply", "--check", patchFile], { cwd: source });
  await run("git", ["apply", patchFile], { cwd: source });
  await NodeFSP.copyFile(NodePath.join(source, ".env.example"), NodePath.join(source, ".env"));
  const pm = (await json(NodePath.join(source, "package.json"))).packageManager;
  await run("npx", ["--yes", pm, "install", "--frozen-lockfile"], { cwd: source });
  const vp = NodePath.join(source, "node_modules/.bin/vp");
  await run(
    vp,
    [
      "test",
      "run",
      "packages/contracts/src/idleCompaction.test.ts",
      "apps/server/src/orchestration-v2/IdleCompactionWorker.test.ts",
    ],
    { cwd: source },
  );
  await run("node", ["scripts/update-release-package-versions.ts", version], { cwd: source });
  const env = { PATH: `${NodePath.join(source, "node_modules/.bin")}:${process.env.PATH}` };
  await run(vp, ["run", "--filter", "t3", "build"], { cwd: source, env });
  await run(
    "npx",
    ["--yes", "--package=node@26.8.2", "--", "node", "apps/server/scripts/cli.ts", "build-exe"],
    { cwd: source, env },
  );

  if (await exists(target)) {
    // Preserve old hashed client assets for browsers still running the old bundle.
    await NodeFSP.cp(target, staging, { recursive: true });
  } else {
    release ??= await api(`releases/tags/v${version}`);
    const asset = release.assets.find(
      (item) => item.name === `t3-${version}-${NodeOS.platform()}-${NodeOS.arch()}.tar.gz`,
    );
    if (!asset?.digest?.startsWith("sha256:"))
      throw new Error("Official archive has no SHA-256 digest");
    const response = await fetch(asset.browser_download_url);
    if (!response.ok) throw new Error(`Archive download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (`sha256:${NodeCrypto.createHash("sha256").update(bytes).digest("hex")}` !== asset.digest)
      throw new Error("Official archive checksum mismatch");
    const official = NodePath.join(work, "official.tar.gz");
    await NodeFSP.writeFile(official, bytes);
    await NodeFSP.mkdir(staging, { recursive: true });
    await run("tar", ["-xzf", official, "--strip-components=1", "-C", staging]);
    if (!(await exists(NodePath.join(staging, "t3"))))
      throw new Error("Unexpected official archive layout");
  }
  await NodeFSP.copyFile(
    NodePath.join(source, "apps/server/dist-exe/t3"),
    NodePath.join(staging, "t3"),
  );
  await NodeFSP.chmod(NodePath.join(staging, "t3"), 0o755);
  if (NodeOS.platform() === "darwin")
    await run("codesign", ["--force", "--sign", "-", NodePath.join(staging, "t3")]);
  await NodeFSP.cp(
    NodePath.join(source, "apps/server/dist/client"),
    NodePath.join(staging, "client"),
    {
      recursive: true,
    },
  );
  const actual = await run(NodePath.join(staging, "t3"), ["--version"], { capture: true });
  if (!actual.includes(version)) throw new Error(`Unexpected built version: ${actual}`);
  const smokeArchive = NodePath.join(work, "patched-smoke.tar.gz");
  await run("tar", [
    "-czf",
    smokeArchive,
    "-C",
    NodePath.dirname(staging),
    NodePath.basename(staging),
  ]);
  await run(
    "node",
    ["scripts/smoke-cli-archive.ts", "--archive", smokeArchive, "--expect-version", version],
    { cwd: source },
  );
  await NodeFSP.writeFile(NodePath.join(staging, ".install-complete"), version + "\n");
  await writeJson(NodePath.join(staging, markerName), {
    version,
    patchCommit: config.patchCommit,
    featureHash: config.featureHash,
    sourcePath: source,
    builtAt: new Date().toISOString(),
    sha256: NodeCrypto.createHash("sha256")
      .update(await NodeFSP.readFile(NodePath.join(staging, "t3")))
      .digest("hex"),
  });
  await publish(version, staging, config.patchCommit);
}

async function main() {
  const [action = "status", ...args] = process.argv.slice(2);
  const version = args.find((arg) => !arg.startsWith("--"));
  await NodeFSP.mkdir(state, { recursive: true });
  if (action !== "install" && action !== "bootstrap" && (await exists(configFile)))
    repo = (await json(configFile)).repo ?? repo;
  const context = {
    repo,
    base,
    state,
    home,
    versions,
    markerName,
    configFile,
    run,
    exists,
    json,
    writeJson,
    prepare,
    publish,
    settings,
    samePatch,
    script: NodeURL.fileURLToPath(import.meta.url),
  };
  if (action === "bootstrap") {
    await bootstrapExport(context, version);
    return;
  }
  if (action === "inspect") {
    console.log(JSON.stringify(await inspectLocal(context)));
    return;
  }
  if (action === "auto-update") {
    const autoFile = NodePath.join(state, "fleet-auto.json");
    const auto = await json(autoFile).catch(() => ({}));
    await withLock(async () => {
      const target =
        auto.status === "failed" || !auto.targetVersion
          ? (await latestRelease()).tag_name.slice(1)
          : auto.targetVersion;
      if (!versionPattern.test(target)) throw new Error("Invalid queued nightly version");
      await writeJson(autoFile, {
        ...auto,
        targetVersion: target,
        attemptedAt: new Date().toISOString(),
        status: "running",
      });
      try {
        await runFleet(context, target);
        await writeJson(autoFile, {
          targetVersion: null,
          completedVersion: target,
          completedAt: new Date().toISOString(),
          status: "completed",
        });
      } catch (error) {
        await writeJson(autoFile, {
          ...auto,
          targetVersion: target,
          attemptedAt: new Date().toISOString(),
          status: /Active agent work/.test(String(error)) ? "deferred" : "failed",
          error: String(error),
        });
        throw error;
      }
    }, "fleet-lock");
    return;
  }
  if (action === "install-auto") {
    if (NodeOS.platform() !== "linux")
      throw new Error("Install the fleet coordinator on a Linux node");
    const unitDir = NodePath.join(NodeOS.homedir(), ".config/systemd/user");
    await NodeFSP.mkdir(unitDir, { recursive: true });
    const unitQuote = (s) =>
      '"' + String(s).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%") + '"';
    const envPath = [
      NodePath.dirname(process.execPath),
      NodePath.join(NodeOS.homedir(), ".local/bin"),
      NodePath.join(NodeOS.homedir(), ".local/share/mise/shims"),
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ].join(":");
    await NodeFSP.writeFile(
      NodePath.join(unitDir, "t3-fleet-update.service"),
      `[Unit]\nDescription=Prepare and synchronize patched T3 nightly on all nodes\n[Service]\nType=oneshot\nWorkingDirectory=${unitQuote(repo)}\nEnvironment=${unitQuote("PATH=" + envPath)}\nExecStart=${unitQuote(process.execPath)} ${unitQuote(context.script)} auto-update\nTimeoutStartSec=8h\n`,
    );
    await NodeFSP.writeFile(
      NodePath.join(unitDir, "t3-fleet-update.timer"),
      "[Unit]\nDescription=Retry the coordinated T3 nightly update every five minutes\n[Timer]\nOnBootSec=2min\nOnUnitInactiveSec=5min\nPersistent=true\n[Install]\nWantedBy=timers.target\n",
    );
    await run("systemctl", ["--user", "daemon-reload"]);
    await run("systemctl", ["--user", "enable", "--now", "t3-fleet-update.timer"]);
    console.log(
      "Fleet update timer enabled; run systemctl --user start --no-block t3-fleet-update.service to update now.",
    );
    return;
  }
  if (action === "export") {
    console.log(await exportPatch(context));
    return;
  }
  if (action === "activate") {
    await withLock(() => activateLocal(context, version));
    return;
  }
  if (action === "activate-fleet") {
    const transaction = args.find((arg) => arg.startsWith("--transaction="))?.slice(14);
    if (!/^[a-zA-Z0-9-]+$/.test(transaction ?? "")) throw new Error("Invalid fleet transaction ID");
    await json(NodePath.join(state, `fleet-snapshot-${transaction}.json`));
    context.transaction = transaction;
    await withLock(() => activateLocal(context, version));
    return;
  }
  if (action === "snapshot-fleet" || action === "rollback-fleet") {
    await withLock(() =>
      action === "snapshot-fleet"
        ? snapshotFleetNode(context, version)
        : rollbackFleetNode(context, version),
    );
    return;
  }
  if (action === "prepare-desktop") {
    if (!versionPattern.test(version)) throw new Error("Expected an exact nightly version");
    await withLock(() => prepareDesktop(context, version));
    return;
  }
  if (action === "repair-desktop-launch") {
    await withLock(() => repairDesktopLaunch(context));
    return;
  }
  if (action === "validate-desktop") {
    if (!versionPattern.test(version)) throw new Error("Expected an exact nightly version");
    await withLock(() => validateDesktopGui(context, version));
    return;
  }
  if (action === "update" || action === "update-all") {
    const target = version ?? (await latestRelease()).tag_name.slice(1);
    if (!versionPattern.test(target)) throw new Error("Expected an exact nightly version");
    await withLock(() => runFleet(context, target), "fleet-lock");
    return;
  }
  if (action === "install") {
    const patchCommit = await run("git", ["rev-parse", "HEAD"], { capture: true });
    if (await run("git", ["status", "--porcelain"], { capture: true }))
      throw new Error("Commit the patch before installing");
    const previous = (await exists(configFile)) ? await json(configFile) : {};
    await writeJson(configFile, {
      localNode: previous.localNode,
      desktopAppPath: previous.desktopAppPath,
      allowDesktopLocalBuild: previous.allowDesktopLocalBuild,
      repo,
      patchCommit,
      base,
      featureHash: await featureHash(patchCommit),
      buildRoot:
        process.env.T3_PATCH_BUILD_DIR ?? previous.buildRoot ?? NodePath.join(state, "builds"),
    });
    const command = NodePath.join(NodeOS.homedir(), ".local/bin/t3-nightly-patch");
    if (
      (await exists(command)) &&
      (await NodeFSP.realpath(command)) !== NodeURL.fileURLToPath(import.meta.url)
    )
      throw new Error("Command already exists at a different path");
    await NodeFSP.mkdir(NodePath.dirname(command), { recursive: true });
    if (!(await exists(command)))
      await NodeFSP.symlink(NodeURL.fileURLToPath(import.meta.url), command);
    await NodeFSP.chmod(NodeURL.fileURLToPath(import.meta.url), 0o755);
    console.log(`Installed ${command}; patch ${patchCommit}`);
    return;
  }
  if (action === "status") {
    const pending = [];
    for (const name of await NodeFSP.readdir(state))
      if (/^pending-.*\.json$/.test(name)) {
        const item = await json(NodePath.join(state, name));
        if (await exists(item.staging)) pending.push(item);
      }
    console.log(
      JSON.stringify(
        {
          config: (await exists(configFile)) ? await json(configFile) : null,
          pending,
          lastSuccess: (await exists(NodePath.join(state, "last-success.json")))
            ? await json(NodePath.join(state, "last-success.json"))
            : null,
          lastError: (await exists(NodePath.join(state, "last-error.json")))
            ? await json(NodePath.join(state, "last-error.json"))
            : null,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (action === "disable-auto") {
    await settings();
    const env = {
      XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus`,
    };
    await run("systemctl", ["--user", "disable", "--now", "t3-nightly-patch.timer"], { env });
    return;
  }
  if (!["apply", "prepare-latest"].includes(action))
    throw new Error(
      "Usage: t3-nightly-patch update-all [version] | update [version] | status | apply [version] | prepare-latest | install | disable-auto",
    );
  await withLock(async () => {
    const release = action === "prepare-latest" ? await latestRelease() : undefined;
    const target = release ? release.tag_name.slice(1) : (version ?? (await installedVersion()));
    await prepare(target, release);
    await prepareDesktop(context, target);
  });
}

async function withLock(work, name = "lock") {
  const lock = NodePath.join(state, name);
  try {
    await NodeFSP.mkdir(lock);
  } catch (error) {
    if (error.code === "EEXIST") {
      const owner = await json(NodePath.join(lock, "owner.json")).catch(() => null);
      let alive = true;
      if (owner?.pid) {
        try {
          process.kill(owner.pid, 0);
        } catch (probe) {
          if (probe.code === "ESRCH") alive = false;
        }
      }
      if (alive) {
        throw new Error("Another patch build holds the lock", { cause: error });
      }
      await NodeFSP.rename(lock, `${lock}.stale-${Date.now()}`);
      await NodeFSP.mkdir(lock);
    } else {
      throw error;
    }
  }
  await writeJson(NodePath.join(lock, "owner.json"), {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  try {
    await work();
  } finally {
    await NodeFSP.unlink(NodePath.join(lock, "owner.json"));
    await NodeFSP.rmdir(lock);
  }
}

main().catch(async (error) => {
  console.error(error.stack ?? String(error));
  await NodeFSP.mkdir(state, { recursive: true });
  await writeJson(NodePath.join(state, "last-error.json"), {
    at: new Date().toISOString(),
    error: String(error),
  });
  process.exitCode = 1;
});
