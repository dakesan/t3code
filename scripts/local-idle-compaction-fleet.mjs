/* oxlint-disable t3code/no-global-process-runtime -- Standalone deployment CLI boundary. */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import { discoverDesktop, activateDesktop } from "./local-idle-compaction-desktop.mjs";

export const quote = (value) => "'" + String(value).replaceAll("'", "'\\''") + "'";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
};
const versionPattern = /^0\.0\.\d+-nightly\.\d{8}\.\d+$/;

export async function exportPatch(ctx) {
  const config = await ctx.settings();
  const patch = config.patchFile
    ? (await NodeFSP.readFile(config.patchFile, "utf8")).trim()
    : await ctx.run(
        "git",
        ["diff", "--binary", ctx.base, config.patchCommit, "--", "apps", "packages"],
        { capture: true },
      );
  const hash = NodeCrypto.createHash("sha256").update(patch).digest("hex");
  const root = NodePath.join(ctx.state, "distribution", hash);
  await NodeFSP.mkdir(root, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(root, "feature.patch"), patch + "\n");
  await ctx.writeJson(NodePath.join(root, "manifest.json"), {
    base: ctx.base,
    patchCommit: config.patchCommit,
    featureHash: hash,
  });
  for (const name of [
    "local-idle-compaction-patch.mjs",
    "local-idle-compaction-fleet.mjs",
    "local-idle-compaction-desktop.mjs",
  ])
    await NodeFSP.copyFile(
      NodePath.join(NodePath.dirname(ctx.script), name),
      NodePath.join(root, name),
    );
  return root;
}

export async function bootstrapExport(ctx, root) {
  const manifest = await ctx.json(NodePath.join(root, "manifest.json"));
  const patchFile = NodePath.resolve(root, "feature.patch");
  const hash = NodeCrypto.createHash("sha256")
    .update((await NodeFSP.readFile(patchFile, "utf8")).trim())
    .digest("hex");
  if (
    hash !== manifest.featureHash ||
    manifest.base !== ctx.base ||
    !/^[a-f0-9]{40}$/.test(manifest.patchCommit)
  )
    throw new Error("Invalid patch distribution");
  const repo = NodePath.join(ctx.state, "upstream.git");
  if (!(await ctx.exists(repo))) {
    await ctx.run("git", ["init", "--bare", repo], { cwd: ctx.state });
    await ctx.run(
      "git",
      ["--git-dir", repo, "remote", "add", "origin", "https://github.com/pingdotgg/t3code.git"],
      { cwd: ctx.state },
    );
  }
  const previous = await ctx.json(ctx.configFile).catch(() => ({}));
  await ctx.writeJson(ctx.configFile, { ...previous, ...manifest, patchFile, repo });
  const command = NodePath.join(NodeOS.homedir(), ".local/bin/t3-nightly-patch");
  await NodeFSP.mkdir(NodePath.dirname(command), { recursive: true });
  const target = NodePath.join(root, "local-idle-compaction-patch.mjs");
  const existing = await NodeFSP.readlink(command).catch(() => null);
  if ((await ctx.exists(command)) && existing !== target)
    throw new Error(`Command already exists: ${command}`);
  await NodeFSP.chmod(target, 0o755);
  if (!existing) await NodeFSP.symlink(target, command);
}

export function countActiveWork(db) {
  const active = "'preparing','queued','starting','running','waiting'";
  const runs = Number(
    db
      .prepare(
        `SELECT count(*) AS n FROM orchestration_v2_projection_runs WHERE status IN (${active})`,
      )
      .get().n,
  );
  const requests = Number(
    db
      .prepare(
        "SELECT count(*) AS n FROM orchestration_v2_projection_runtime_requests WHERE status = 'pending'",
      )
      .get().n,
  );
  // A completed parent can leave a stale app-owned subagent projection. Its
  // independently running child is still covered by the global run count.
  const subagents = Number(
    db
      .prepare(`SELECT count(*) AS n FROM orchestration_v2_projection_subagents s
    WHERE s.status IN ('pending',${active}) AND (
      s.run_id IS NULL OR NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_runs r WHERE r.run_id=s.run_id)
      OR EXISTS (SELECT 1 FROM orchestration_v2_projection_runs r WHERE r.run_id=s.run_id AND r.status IN (${active}))
      OR EXISTS (SELECT 1 FROM orchestration_v2_projection_runs r WHERE r.thread_id=s.child_thread_id AND r.status IN (${active}))
    )`)
      .get().n,
  );
  return runs + requests + subagents;
}

export async function inspectLocal(ctx) {
  const ps = await ctx.run("ps", ["-axo", "pid=,command="], { capture: true });
  const processes = ps
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(.*)$/);
      return match ? { pid: Number(match[1]), command: match[2] } : null;
    })
    .filter(Boolean);
  const desktop = await discoverDesktop(ctx, processes);
  const plist = NodePath.join(
    NodeOS.homedir(),
    "Library/LaunchAgents/com.t3tools.t3code.service.plist",
  );
  const service =
    NodeOS.platform() === "darwin"
      ? await ctx.exists(plist)
      : await ctx.exists(NodePath.join(NodeOS.homedir(), ".config/systemd/user/t3code.service"));
  const managed = [];
  const launchRoot = NodePath.join(ctx.home, "ssh-launch");
  for (const name of await NodeFSP.readdir(launchRoot).catch(() => [])) {
    const root = NodePath.join(launchRoot, name);
    if (
      (await NodeFSP.readFile(NodePath.join(root, "managed"), "utf8").catch(() => "")).trim() !==
      "managed"
    )
      continue;
    const pid = Number(
      (await NodeFSP.readFile(NodePath.join(root, "pid"), "utf8").catch(() => "")).trim(),
    );
    const port = Number(
      (await NodeFSP.readFile(NodePath.join(root, "port"), "utf8").catch(() => "")).trim(),
    );
    const proc = processes.find((p) => p.pid === pid);
    if (!proc) continue;
    const match = proc.command.match(/^(.*\/runtime\/versions\/([^/]+)\/t3)\s+serve(?:\s|$)/);
    if (
      !match ||
      !match[1].startsWith(ctx.versions + "/") ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      throw new Error(`Unrecognized SSH-managed process: ${root}`);
    managed.push({ root, pid, port, version: match[2] });
  }
  let busy = 0;
  const dbFile = NodePath.join(ctx.home, "userdata/statev2.sqlite");
  if (await ctx.exists(dbFile)) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      busy = countActiveWork(db);
    } finally {
      db.close();
    }
  }
  const servers = processes.filter(
    (p) => p.command.startsWith(ctx.versions + "/") && /\/t3 serve(?:\s|$)/.test(p.command),
  );
  const serviceState = await ctx
    .json(NodePath.join(ctx.home, "runtime/service-state.json"))
    .catch(() => null);
  return {
    hostname: NodeOS.hostname(),
    platform: NodeOS.platform(),
    arch: NodeOS.arch(),
    home: NodeOS.homedir(),
    service,
    serviceVersion: serviceState?.activeVersion ?? null,
    managed,
    desktop,
    busy,
    serverPids: servers.map((p) => p.pid),
    serverVersions: servers.map((p) => p.command.slice(ctx.versions.length + 1).split("/")[0]),
  };
}

export function assertReady(info) {
  if (info.desktop && typeof info.desktop !== "object")
    throw new Error("The Desktop installation could not be identified for patching.");
  if (info.busy) throw new Error(`Active agent work (${info.busy}); retry after it finishes.`);
  if (info.desktop && (info.service || info.managed.length))
    throw new Error("Desktop and CLI launchers share a node; refusing an ambiguous restart");
  if (!info.desktop && !info.service && !info.managed.length)
    throw new Error("No supported T3 service or SSH-managed server found");
}

export async function activateLocal(ctx, version) {
  if (!versionPattern.test(version)) throw new Error("Expected an exact nightly version");
  const info = await inspectLocal(ctx);
  assertReady(info);
  if (info.desktop) return activateDesktop(ctx, version, info, () => inspectLocal(ctx));
  const pending = await ctx
    .json(NodePath.join(ctx.state, `pending-${version}.json`))
    .catch(() => null);
  const target = NodePath.join(ctx.versions, version);
  const staged = pending && (await ctx.exists(pending.staging)) ? pending.staging : target;
  const marker = await ctx.json(NodePath.join(staged, ctx.markerName));
  const config = await ctx.settings();
  if (marker.patchCommit !== config.patchCommit && marker.featureHash !== config.featureHash)
    throw new Error("Requested runtime does not contain the current patch");
  const known = new Set(info.managed.map((s) => s.pid));
  // Service children are stopped by the service manager, never by process-name matching.
  if (!info.service && info.serverPids.some((pid) => !known.has(pid)))
    throw new Error("An unmanaged T3 server is running");
  const originals = await Promise.all(
    info.managed.map(async (server) => ({
      ...server,
      runner: await NodeFSP.readFile(NodePath.join(server.root, "run-t3.sh"), "utf8"),
    })),
  );
  const plist = NodePath.join(
    NodeOS.homedir(),
    "Library/LaunchAgents/com.t3tools.t3code.service.plist",
  );
  const stopService = async () => {
    if (!info.service) return;
    if (NodeOS.platform() === "darwin")
      await ctx.run("launchctl", ["bootout", `gui/${process.getuid()}`, plist]);
    else await ctx.run("systemctl", ["--user", "stop", "t3code.service"]);
  };
  const startService = async (runtimeVersion, rollback = false) => {
    if (info.service)
      await ctx.run(NodePath.join(ctx.versions, runtimeVersion, "t3"), [
        "service",
        "install",
        "--base-dir",
        ctx.home,
        ...(rollback ? ["--allow-downgrade"] : []),
      ]);
  };
  const started = new Map();
  const startManaged = async (server, runner) => {
    await NodeFSP.writeFile(NodePath.join(server.root, "run-t3.sh"), runner);
    const log = await NodeFSP.open(NodePath.join(server.root, "server.log"), "a");
    const child = NodeChildProcess.spawn(
      "sh",
      [
        NodePath.join(server.root, "run-t3.sh"),
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        String(server.port),
        "--base-dir",
        ctx.home,
      ],
      { detached: true, stdio: ["ignore", log.fd, log.fd], cwd: NodeOS.homedir() },
    );
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    started.set(server.root, child.pid);
    await log.close();
    await NodeFSP.writeFile(NodePath.join(server.root, "pid"), String(child.pid) + "\n");
    for (let attempt = 0; attempt < 60; attempt++) {
      if (!alive(child.pid))
        throw new Error(`T3 exited during startup; see ${server.root}/server.log`);
      const response = await fetch(`http://127.0.0.1:${server.port}/`, {
        signal: AbortSignal.timeout(1000),
      }).catch(() => null);
      if (response?.ok) return;
      await sleep(500);
    }
    process.kill(child.pid, "SIGTERM");
    throw new Error(`Server readiness timed out on port ${server.port}`);
  };
  let published = false;
  let serviceStarted = false;
  try {
    await stopService();
    for (const server of originals) if (alive(server.pid)) process.kill(server.pid, "SIGTERM");
    for (let attempt = 0; attempt < 120 && info.serverPids.some(alive); attempt++) await sleep(500);
    if (info.serverPids.some(alive))
      throw new Error("A server did not stop gracefully; no runtime was replaced");
    if (staged !== target) {
      await ctx.publish(version, staged, config.patchCommit);
      if (await ctx.exists(staged))
        throw new Error("The runtime was started concurrently; activation remains pending");
      published = true;
    }
    serviceStarted = info.service;
    await startService(version);
    for (const server of originals)
      await startManaged(
        server,
        server.runner.replace(/^T3_ARCHIVE_VERSION='[^']*'$/m, `T3_ARCHIVE_VERSION='${version}'`),
      );
    let after;
    for (let attempt = 0; attempt < 60; attempt++) {
      after = await inspectLocal(ctx);
      if (after.serverPids.length >= info.serverPids.length) break;
      await sleep(500);
    }
    if (after.serverPids.length < info.serverPids.length)
      throw new Error("Not all T3 server processes restarted");
    if (after.serverVersions.some((running) => running !== version))
      throw new Error("A T3 server is still running another version");
    if (info.service && after.serviceVersion !== version)
      throw new Error("Service did not select the requested version");
    if (
      after.managed.some((server) => server.version !== version) ||
      after.managed.length !== originals.length
    )
      throw new Error("SSH server version verification failed");
    console.log(`${NodeOS.hostname()}: ${version} patch active`);
    return after;
  } catch (error) {
    // Stop only the processes launched here before restoring their former launchers.
    if (serviceStarted) await stopService().catch((failure) => console.error(String(failure)));
    for (const pid of started.values()) if (alive(pid)) process.kill(pid, "SIGTERM");
    for (let attempt = 0; attempt < 60 && [...started.values()].some(alive); attempt++)
      await sleep(500);
    if ([...started.values()].some(alive))
      throw new Error("Rollback waits for a newly started server to stop", { cause: error });
    if (published) {
      const record = await ctx.json(NodePath.join(ctx.state, "last-success.json"));
      if (record.backup) {
        await NodeFSP.rename(target, `${target}.failed-${Date.now()}`);
        await NodeFSP.rename(record.backup, target);
      }
    }
    if (info.serviceVersion)
      await startService(info.serviceVersion, true).catch((rollback) =>
        console.error(`Service rollback failed: ${rollback}`),
      );
    for (const server of originals) {
      if (alive(server.pid)) continue;
      await startManaged(server, server.runner).catch((rollback) =>
        console.error(`SSH server rollback failed: ${rollback}`),
      );
    }
    throw error;
  }
}

export async function fleetTransaction(
  nodes,
  prepare,
  preflight,
  activate,
  activationOrder = () => nodes,
) {
  // Every node must be reachable before builds or service changes begin.
  const checkAll = async () => {
    const results = await Promise.allSettled(nodes.map(preflight));
    const failures = results.flatMap((result, index) =>
      result.status === "rejected" ? [`${nodes[index]}: ${String(result.reason)}`] : [],
    );
    if (failures.length) throw new Error(failures.join("\n"));
  };
  await checkAll();
  for (const node of nodes) await prepare(node);
  await checkAll();
  for (const node of activationOrder()) await activate(node);
}

export async function runFleet(ctx, version) {
  const config = await ctx.settings();
  const nodes = ["logomix", "macmini", "myhome", "macbook"];
  const localNode =
    config.localNode ??
    {
      "owner-Super-Server": "logomix",
      "oodake-home-ubuntu": "myhome",
      "HiroyukinoMac-mini.local": "macmini",
      "OdakeMac.local": "macbook",
    }[NodeOS.hostname()];
  if (!localNode)
    throw new Error("Set localNode in the patch config to one of logomix/macmini/myhome/macbook");
  const payload = await exportPatch(ctx);
  const sshArgs = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
  ];
  const envSetup =
    'export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$HOME/.mise/shims:/opt/homebrew/bin:/usr/local/bin:$PATH"; ';
  const unlock =
    'if [ "$(uname -s)" = Darwin ]; then security unlock-keychain "$HOME/Library/Keychains/login.keychain-db" || exit; fi; ';
  const report = { version, startedAt: new Date().toISOString(), nodes: {} };
  const reportFile = NodePath.join(ctx.state, "fleet-last.json");
  const remote = (node, command, capture = false) =>
    ctx.run("ssh", [...sshArgs, node, envSetup + command], { capture });
  const info = new Map();
  try {
    // Discovery is read-only and does not require the patch command to be installed.
    const discoveries = await Promise.allSettled(
      nodes.map(async (node) => {
        if (node === localNode) return info.set(node, { home: NodeOS.homedir(), local: true });
        const raw = await remote(
          node,
          "node -e " + quote('console.log(JSON.stringify({home:require("node:os").homedir()}))'),
          true,
        );
        info.set(node, JSON.parse(raw.split("\n").at(-1)));
      }),
    );
    discoveries.forEach((result, index) => {
      report.nodes[nodes[index]] =
        result.status === "fulfilled"
          ? { status: "reachable" }
          : { status: "unreachable", error: String(result.reason) };
    });
    if (discoveries.some((result) => result.status === "rejected"))
      throw new Error("Some nodes are unreachable; no server was restarted. See fleet-last.json.");
    for (const node of nodes) {
      if (node === localNode) continue;
      const root = NodePath.posix.join(info.get(node).home, ".local/share/t3-nightly-patch/agent");
      info.get(node).root = root;
      await remote(node, `mkdir -p ${quote(root)}`);
      await ctx.run("scp", [
        "-q",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        ...[
          "manifest.json",
          "feature.patch",
          "local-idle-compaction-patch.mjs",
          "local-idle-compaction-fleet.mjs",
          "local-idle-compaction-desktop.mjs",
        ].map((name) => NodePath.join(payload, name)),
        `${node}:${root}/`,
      ]);
      await remote(
        node,
        unlock +
          `node ${quote(root + "/local-idle-compaction-patch.mjs")} bootstrap ${quote(root)}`,
      );
    }
    const call = async (node, action, capture = false) => {
      const script =
        node === localNode ? ctx.script : info.get(node).root + "/local-idle-compaction-patch.mjs";
      const args = [script, action, version];
      return node === localNode
        ? ctx.run(process.execPath, args, { capture })
        : remote(node, unlock + ["node", ...args].map(quote).join(" "), capture);
    };
    await fleetTransaction(
      nodes,
      async (node) => {
        await call(node, "apply");
        report.nodes[node] = { status: "prepared" };
        await ctx.writeJson(reportFile, report);
      },
      async (node) => {
        try {
          const inspection = JSON.parse((await call(node, "inspect", true)).split("\n").at(-1));
          report.nodes[node] = { ...report.nodes[node], inspection };
          assertReady(inspection);
        } catch (error) {
          report.nodes[node] = { ...report.nodes[node], status: "blocked", error: String(error) };
          throw error;
        }
      },
      async (node) => {
        await call(node, "activate");
        report.nodes[node] = { status: "active" };
        await ctx.writeJson(reportFile, report);
      },
      () =>
        [...nodes].sort(
          (a, b) =>
            Number(Boolean(report.nodes[b].inspection?.desktop)) -
            Number(Boolean(report.nodes[a].inspection?.desktop)),
        ),
    );
    report.completedAt = new Date().toISOString();
  } catch (error) {
    report.error = String(error);
    throw error;
  } finally {
    await ctx.writeJson(reportFile, report);
    console.log(`Fleet report: ${reportFile}`);
  }
}
