/* oxlint-disable t3code/no-global-process-runtime -- Standalone deployment boundary. */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");
const exists = (file) =>
  NodeFSP.access(file).then(
    () => true,
    () => false,
  );
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
};
const markerName = ".idle-compaction-patch.json";
const lsregister =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export async function unregisterDesktopCopy(ctx, appPath) {
  if (NodeOS.platform() !== "darwin") return;
  const before = await ctx.run(lsregister, ["-dump"], { capture: true });
  if (!launchRegistryPaths(before).includes(appPath)) return;
  try {
    await ctx.run(lsregister, ["-u", appPath]);
  } catch (error) {
    const dump = await ctx.run(lsregister, ["-dump"], { capture: true });
    if (launchRegistryPaths(dump).includes(appPath)) throw error;
  }
}

export function launchRegistryPaths(dump) {
  return dump.split("\n").flatMap((line) => {
    const match = line.match(/^\s*path:\s+(.*?)\s+\(0x[0-9a-f]+\)\s*$/i);
    return match ? [match[1]] : [];
  });
}

export function repairStagingPath(appPath) {
  const parent = NodePath.dirname(appPath);
  return parent.endsWith(".noindex")
    ? appPath
    : NodePath.join(parent + ".noindex", NodePath.basename(appPath));
}

export function guiValidationMetadata(original) {
  const info = {
    ...original,
    CFBundleIdentifier: "bio.logomix.t3-patch-validation",
    CFBundleDisplayName: "T3 Patch Validation",
  };
  // Electron resolves helper executables using the original bundle name.
  delete info.CFBundleURLTypes;
  delete info.CFBundleDocumentTypes;
  return info;
}

export const copyDesktopApp = (source, destination) =>
  NodeFSP.cp(source, destination, { recursive: true, verbatimSymlinks: true });

export async function repairDesktopLaunch(ctx) {
  if (NodeOS.platform() !== "darwin") throw new Error("Desktop launch repair is macOS-only");
  const root = NodePath.join(ctx.state, "desktop");
  const moves = [];
  for (const entry of await NodeFSP.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const parent = NodePath.join(root, entry.name);
    const appPath = NodePath.join(parent, "T3 Code (Nightly).app");
    if (!(await exists(appPath))) continue;
    await unregisterDesktopCopy(ctx, appPath);
    const repaired = repairStagingPath(appPath);
    if (repaired !== appPath) {
      await NodeFSP.rename(parent, NodePath.dirname(repaired));
      moves.push([appPath, repaired]);
    }
  }
  for (const name of await NodeFSP.readdir(ctx.state)) {
    if (!/^desktop-ready-.*\.json$/.test(name)) continue;
    const file = NodePath.join(ctx.state, name);
    const ready = await ctx.json(file);
    for (const [before, after] of moves) if (ready.stagedApp === before) ready.stagedApp = after;
    await ctx.writeJson(file, ready);
  }
  const desktop = await discoverDesktop(ctx, []);
  if (!desktop) throw new Error("Installed Nightly app not found");
  await ctx.run("codesign", ["--verify", "--deep", "--strict", desktop.appPath]);
  await ctx.run(lsregister, ["-f", desktop.appPath]);
  await ctx.run("open", ["-a", desktop.appPath]);
  console.log(`Installed Nightly reopened: ${desktop.appPath}; staged copies unregistered.`);
}

async function installedPatch(ctx, desktop, version, featureHash) {
  const record = await ctx
    .json(NodePath.join(desktop.appPath, "Contents/Resources", markerName))
    .catch(() => null);
  return (
    record?.version === version &&
    record.fleetManaged === true &&
    record.featureHash === featureHash &&
    hash(await NodeFSP.readFile(NodePath.join(desktop.appPath, "Contents/Resources/app.asar"))) ===
      record.asarSha256
  );
}

export function desktopProcesses(processes, appPath, executable) {
  const inside = processes.filter((p) => p.command.startsWith(appPath + "/"));
  return {
    pids: inside.map((p) => p.pid),
    mainPids: inside
      .filter(
        (p) =>
          p.command === executable ||
          (p.command.startsWith(executable + " ") &&
            !p.command.includes("/app.asar/") &&
            !p.command.includes("--type=")),
      )
      .map((p) => p.pid),
    backendPids: inside
      .filter((p) => p.command.includes("/app.asar/apps/server/dist/bin.mjs"))
      .map((p) => p.pid),
  };
}

export async function discoverDesktop(ctx, processes) {
  if (NodeOS.platform() !== "darwin") return null;
  const paths = [
    "/Applications/T3 Code (Nightly).app",
    NodePath.join(NodeOS.homedir(), "Applications/T3 Code (Nightly).app"),
  ];
  const config = await ctx.settings().catch(() => ({}));
  if (config.desktopAppPath) paths.unshift(config.desktopAppPath);
  for (const appPath of new Set(paths)) {
    if (!(await ctx.exists(NodePath.join(appPath, "Contents/Info.plist")))) continue;
    const plist = NodePath.join(appPath, "Contents/Info.plist");
    const version = await ctx.run(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleShortVersionString", plist],
      { capture: true },
    );
    if (!/^0\.0\.\d+-nightly\.\d{8}\.\d+$/.test(version))
      throw new Error("Selected Desktop app is not a nightly");
    const name = await ctx.run(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleExecutable", plist],
      { capture: true },
    );
    const executable = NodePath.join(appPath, "Contents/MacOS", name);
    return { appPath, version, executable, ...desktopProcesses(processes, appPath, executable) };
  }
  return null;
}

// Preserve exactly the original archive's unpacked native modules and helpers.
export function unpackedFiles(header, prefix = "", inherited = false) {
  return Object.entries(header.files ?? {}).flatMap(([name, entry]) => {
    const file = prefix ? `${prefix}/${name}` : name;
    const unpacked = inherited || entry.unpacked === true;
    return entry.files ? unpackedFiles(entry, file, unpacked) : unpacked ? [file] : [];
  });
}

export async function loadAsar(source) {
  const modules = NodePath.join(source, "node_modules/.pnpm");
  for (const name of (await NodeFSP.readdir(modules))
    .filter((name) => name.startsWith("@electron+asar@"))
    .sort()
    .toReversed()) {
    const path = NodePath.join(modules, name, "node_modules/@electron/asar");
    if (await exists(NodePath.join(path, "package.json")))
      return NodeModule.createRequire(import.meta.url)(NodePath.join(path, "lib/asar.js"));
  }
  throw new Error("The source build is missing @electron/asar");
}

export async function repackDesktop(asar, appPath, source, work) {
  const archive = NodePath.join(appPath, "Contents/Resources/app.asar");
  const original = unpackedFiles(asar.getRawHeader(archive).header);
  const tree = NodePath.join(work, "app-tree");
  await NodeFSP.mkdir(tree, { recursive: true });
  asar.extractAll(archive, tree);
  const packageJson = JSON.parse(
    await NodeFSP.readFile(NodePath.join(tree, "package.json"), "utf8"),
  );
  const version = JSON.parse(
    await NodeFSP.readFile(NodePath.join(source, "apps/server/package.json"), "utf8"),
  ).version;
  if (packageJson.version !== version) throw new Error("Desktop and server build versions differ");
  packageJson.t3codeWebAuthn = { browserPasskeys: false };
  const entry = packageJson.main;
  if (typeof entry !== "string" || !entry.endsWith(".cjs"))
    throw new Error("Expected a CommonJS Desktop entry point");
  await NodeFSP.writeFile(
    NodePath.join(tree, "fleet-managed.cjs"),
    `process.env.T3CODE_DISABLE_AUTO_UPDATE = "1";\nrequire(${JSON.stringify("./" + entry)});\n`,
  );
  packageJson.main = "fleet-managed.cjs";
  await NodeFSP.writeFile(
    NodePath.join(tree, "package.json"),
    JSON.stringify(packageJson, null, 2) + "\n",
  );
  await NodeFSP.cp(
    NodePath.join(source, "apps/server/dist"),
    NodePath.join(tree, "apps/server/dist"),
    { recursive: true },
  );
  const updated = NodePath.join(work, "patched.asar");
  const escape = (file) => file.replace(/[?*[\]{}()!+@]/g, "\\$&");
  const paths = original.map((file) => escape(NodePath.join(tree, file)));
  const pattern = paths.length === 1 ? paths[0] : `{${paths.join(",")}}`;
  await asar.createPackageWithOptions(tree, updated, original.length ? { unpack: pattern } : {});
  for (const file of original) {
    if (!asar.statFile(updated, file, false).unpacked)
      throw new Error(`Native unpack flag was lost: ${file}`);
    if (hash(asar.extractFile(archive, file)) !== hash(asar.extractFile(updated, file)))
      throw new Error(`Runtime dependency changed: ${file}`);
  }
  // Only the archive changes here; local signing follows after metadata is written.
  await NodeFSP.rename(archive, NodePath.join(work, "official.asar"));
  await NodeFSP.rename(updated, archive);
  if (await exists(updated + ".unpacked"))
    await NodeFSP.cp(updated + ".unpacked", archive + ".unpacked", { recursive: true });
  return hash(await NodeFSP.readFile(archive));
}

async function signLocalDesktop(ctx, appPath, work) {
  const xml = await ctx.run("codesign", ["-d", "--entitlements", ":-", appPath], { capture: true });
  const entitlementsFile = NodePath.join(work, "local-entitlements.plist");
  const jsonFile = NodePath.join(work, "official-entitlements.json");
  await NodeFSP.writeFile(entitlementsFile, xml);
  await ctx.run("plutil", ["-convert", "json", "-o", jsonFile, entitlementsFile]);
  const entitlements = await ctx.json(jsonFile);
  // Apple developer and keychain-group grants cannot be carried by an ad-hoc signature.
  await ctx.writeJson(
    entitlementsFile,
    Object.fromEntries(
      Object.entries(entitlements).filter(([key]) => key.startsWith("com.apple.security.")),
    ),
  );
  await ctx.run("plutil", ["-convert", "xml1", entitlementsFile]);
  const profile = NodePath.join(appPath, "Contents/embedded.provisionprofile");
  if (await exists(profile))
    await NodeFSP.rename(profile, NodePath.join(work, "official.provisionprofile"));
  await ctx.run("codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--preserve-metadata=entitlements,flags,runtime",
    appPath,
  ]);
  await ctx.run("codesign", [
    "--force",
    "--sign",
    "-",
    "--entitlements",
    entitlementsFile,
    "--preserve-metadata=flags,runtime",
    appPath,
  ]);
  await ctx.run("codesign", ["--verify", "--deep", "--strict", appPath]);
}

async function smokeDesktop(ctx, desktop, appPath, work) {
  const relative = NodePath.relative(desktop.appPath, desktop.executable);
  const executable = NodePath.join(appPath, relative);
  const entry = NodePath.join(appPath, "Contents/Resources/app.asar/apps/server/dist/bin.mjs");
  const socket = NodeNet.createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const home = NodePath.join(work, "smoke-home");
  await NodeFSP.mkdir(home, { recursive: true });
  const log = await NodeFSP.open(NodePath.join(work, "smoke.log"), "a");
  const child = NodeChildProcess.spawn(
    executable,
    [entry, "serve", "--host", "127.0.0.1", "--port", String(port), "--no-browser"],
    {
      cwd: home,
      env: { PATH: "", HOME: home, T3CODE_HOME: home, TMPDIR: work, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", log.fd, log.fd],
    },
  );
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  try {
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (child.exitCode !== null) throw new Error(`Desktop backend exited; see ${work}/smoke.log`);
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1000),
      }).catch(() => null);
      if (response?.ok) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    if (!ready) throw new Error(`Desktop backend readiness timed out; see ${work}/smoke.log`);
    console.log(
      `Desktop backend smoke passed on ${port}, using the app's Electron and native modules.`,
    );
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([exit, sleep(10000)]);
    await log.close();
  }
  if (child.exitCode === null) throw new Error("Isolated Desktop backend did not stop gracefully");
}

export async function validateDesktopGui(ctx, version) {
  if (NodeOS.platform() !== "darwin") throw new Error("Desktop validation is macOS-only");
  const readyFile = NodePath.join(ctx.state, `desktop-ready-${version}.json`);
  const ready = await ctx.json(readyFile);
  if (
    hash(await NodeFSP.readFile(NodePath.join(ready.stagedApp, "Contents/Resources/app.asar"))) !==
    ready.asarSha256
  )
    throw new Error("Prepared Desktop archive changed before GUI validation");
  const work = NodePath.join(ctx.state, "desktop", `gui-${Date.now()}.noindex`);
  const appPath = NodePath.join(work, "T3 Patch Validation.app");
  const home = NodePath.join(work, "home");
  await NodeFSP.mkdir(home, { recursive: true });
  await copyDesktopApp(ready.stagedApp, appPath);
  const plist = NodePath.join(appPath, "Contents/Info.plist");
  const infoJson = NodePath.join(work, "info.json");
  await ctx.run("plutil", ["-convert", "json", "-o", infoJson, plist]);
  const info = guiValidationMetadata(await ctx.json(infoJson));
  await ctx.writeJson(plist, info);
  await ctx.run("plutil", ["-convert", "xml1", plist]);
  await ctx.run("codesign", [
    "--force",
    "--sign",
    "-",
    "--preserve-metadata=entitlements,flags,runtime",
    appPath,
  ]);
  await ctx.run("codesign", ["--verify", "--deep", "--strict", appPath]);
  const executable = NodePath.join(appPath, "Contents/MacOS", info.CFBundleExecutable);
  const t3Home = NodePath.join(home, ".t3");
  let owned = { pids: [], mainPids: [], backendPids: [] };
  let validated = false;
  const snapshot = async () => {
    const ps = await ctx.run("ps", ["-axo", "pid=,command="], { capture: true });
    const rows = ps.split("\n").flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(.*)$/);
      return match ? [{ pid: Number(match[1]), command: match[2] }] : [];
    });
    return {
      ...desktopProcesses(rows, appPath, executable),
      rendererPids: rows
        .filter(
          (row) => row.command.startsWith(appPath + "/") && row.command.includes("--type=renderer"),
        )
        .map((row) => row.pid),
    };
  };
  try {
    await ctx.run("open", [
      "-n",
      "-g",
      "-j",
      "-a",
      appPath,
      "--env",
      `HOME=${home}`,
      "--env",
      `T3CODE_HOME=${t3Home}`,
      "--env",
      "T3CODE_DISABLE_AUTO_UPDATE=1",
      "--stdout",
      NodePath.join(work, "gui.stdout.log"),
      "--stderr",
      NodePath.join(work, "gui.stderr.log"),
    ]);
    for (let attempt = 0; attempt < 90; attempt++) {
      owned = await snapshot();
      const runtime = await ctx
        .json(NodePath.join(t3Home, "userdata/server-runtime.json"))
        .catch(() => null);
      if (
        owned.mainPids.length &&
        owned.rendererPids.length &&
        owned.backendPids.includes(runtime?.pid)
      ) {
        const response = await fetch(`http://127.0.0.1:${runtime.port}/`, {
          signal: AbortSignal.timeout(1000),
        }).catch(() => null);
        if (response?.ok) {
          validated = true;
          break;
        }
      }
      await sleep(500);
    }
    if (!validated) throw new Error(`Desktop GUI did not become ready; isolated state: ${home}`);
    console.log(
      `Desktop GUI started via Launch Services: main=${owned.mainPids.join(",")}, renderer=${owned.rendererPids.join(",")}, backend=${owned.backendPids.join(",")}`,
    );
  } finally {
    owned = await snapshot();
    for (const pid of owned.mainPids) if (alive(pid)) process.kill(pid, "SIGTERM");
    for (let attempt = 0; attempt < 60 && owned.pids.some(alive); attempt++) await sleep(500);
    await unregisterDesktopCopy(ctx, appPath);
  }
  if (owned.pids.some(alive)) throw new Error("Isolated GUI processes have not stopped gracefully");
  ready.guiValidatedAt = new Date().toISOString();
  ready.guiValidation = {
    appPath,
    isolatedHome: home,
    mainAndRendererAndBackend: true,
    asarSha256: ready.asarSha256,
  };
  await ctx.writeJson(readyFile, ready);
  return ready;
}

export async function prepareDesktop(ctx, version) {
  const desktop = await discoverDesktop(ctx, []);
  if (!desktop) return;
  const config = await ctx.settings();
  if (await installedPatch(ctx, desktop, version, config.featureHash)) {
    console.log(`${version}: Desktop patch already installed`);
    return;
  }
  const readyFile = NodePath.join(ctx.state, `desktop-ready-${version}.json`);
  const previous = await ctx.json(readyFile).catch(() => null);
  if (
    previous?.formatVersion === 3 &&
    previous.featureHash === config.featureHash &&
    (await ctx.exists(previous.stagedApp))
  ) {
    if (
      hash(
        await NodeFSP.readFile(NodePath.join(previous.stagedApp, "Contents/Resources/app.asar")),
      ) === previous.asarSha256
    ) {
      await ctx.run("codesign", ["--verify", "--deep", "--strict", previous.stagedApp]);
      if (previous.guiValidation?.asarSha256 !== previous.asarSha256)
        await validateDesktopGui(ctx, version);
      console.log(`${version}: patched Desktop app already prepared`);
      return;
    }
  }
  const pending = await ctx
    .json(NodePath.join(ctx.state, `pending-${version}.json`))
    .catch(() => null);
  const runtime =
    pending && (await ctx.exists(pending.staging))
      ? pending.staging
      : NodePath.join(ctx.versions, version);
  const marker = await ctx.json(NodePath.join(runtime, markerName));
  if (marker.featureHash !== config.featureHash)
    throw new Error("Build the current CLI patch before preparing Desktop");
  const progress = await ctx.json(NodePath.join(ctx.state, "progress.json")).catch(() => null);
  const source =
    marker.sourcePath ??
    (progress?.version === version ? NodePath.join(progress.work, "source") : null);
  if (!source || !(await ctx.exists(NodePath.join(source, "apps/server/dist/bin.mjs"))))
    throw new Error("Desktop preparation requires the matching source build");
  const work = NodePath.join(ctx.state, "desktop", `${version}-${Date.now()}.noindex`);
  await NodeFSP.mkdir(work, { recursive: true });
  const response = await fetch(
    `https://api.github.com/repos/pingdotgg/t3code/releases/tags/v${version}`,
  );
  if (!response.ok) throw new Error(`Desktop release lookup failed: ${response.status}`);
  const release = await response.json();
  const asset = release.assets.find(
    (asset) => asset.name === `T3-Code-${version}-${NodeOS.arch()}.zip`,
  );
  if (!asset?.digest?.startsWith("sha256:"))
    throw new Error("Official Desktop archive lacks a SHA-256 digest");
  const zip = NodePath.join(ctx.state, "desktop", `official-${version}-${NodeOS.arch()}.zip`);
  let bytes;
  if (await exists(zip)) bytes = await NodeFSP.readFile(zip);
  else {
    const download = await fetch(asset.browser_download_url);
    if (!download.ok) throw new Error(`Desktop download failed: ${download.status}`);
    bytes = Buffer.from(await download.arrayBuffer());
  }
  if (`sha256:${hash(bytes)}` !== asset.digest)
    throw new Error("Desktop archive checksum mismatch");
  await NodeFSP.writeFile(zip, bytes);
  await ctx.run("ditto", ["-x", "-k", zip, work]);
  const stagedApp = NodePath.join(work, NodePath.basename(desktop.appPath));
  if (!(await ctx.exists(stagedApp))) throw new Error("Unexpected Desktop archive layout");
  let record;
  try {
    const asar = await loadAsar(source);
    const asarSha256 = await repackDesktop(asar, stagedApp, source, work);
    record = {
      formatVersion: 3,
      fleetManaged: true,
      version,
      featureHash: config.featureHash,
      appPath: desktop.appPath,
      stagedApp,
      asarSha256,
      signing: "ad-hoc",
      browserPasskeys: false,
      preparedAt: new Date().toISOString(),
    };
    await ctx.writeJson(NodePath.join(stagedApp, "Contents/Resources", markerName), record);
    await signLocalDesktop(ctx, stagedApp, work);
    await smokeDesktop(ctx, desktop, stagedApp, work);
  } finally {
    await unregisterDesktopCopy(ctx, stagedApp);
  }
  await ctx.writeJson(readyFile, record);
  await validateDesktopGui(ctx, version);
  console.log(`${version}: patched Desktop app prepared; the running app is unchanged.`);
}

export async function activateDesktop(ctx, version, info, inspect) {
  const desktop = info.desktop;
  if (info.busy && !ctx.allowActive)
    throw new Error(`Active agent work (${info.busy}); Desktop restart deferred`);
  if (info.service || info.managed.length)
    throw new Error("Desktop and CLI launchers share a node; refusing an ambiguous restart");
  const config = await ctx.settings();
  if (config.allowDesktopLocalBuild !== true)
    throw new Error(
      "Desktop patch requires a locally signed build without the official browser passkey/Touch ID grants; acceptance is required before activation",
    );
  if (await installedPatch(ctx, desktop, version, config.featureHash)) {
    console.log(`${version}: Desktop patch already active`);
    return;
  }
  const ready = await ctx.json(NodePath.join(ctx.state, `desktop-ready-${version}.json`));
  if (
    !ready.guiValidation?.mainAndRendererAndBackend ||
    ready.guiValidation.asarSha256 !== ready.asarSha256
  )
    throw new Error("Prepared Desktop app requires successful GUI validation before activation");
  if (ready.appPath !== desktop.appPath || ready.featureHash !== config.featureHash)
    throw new Error("Prepared Desktop app does not match this installation");
  if (
    hash(await NodeFSP.readFile(NodePath.join(ready.stagedApp, "Contents/Resources/app.asar"))) !==
    ready.asarSha256
  )
    throw new Error("Prepared Desktop app was modified after verification");
  const fresh = await inspect();
  if ((fresh.busy && !ctx.allowActive) || fresh.desktop?.version !== desktop.version)
    throw new Error("Desktop state changed; retry after active work finishes");
  const backup = NodePath.join(
    ctx.state,
    "desktop-backups.noindex",
    `${Date.now()}-${NodePath.basename(desktop.appPath)}`,
  );
  // spctl checks distribution/notarization policy and rejects local ad-hoc builds.
  // Use the actual Launch Services GUI probe, bound to the patched archive, instead.
  await ctx.run("codesign", ["--verify", "--deep", "--strict", ready.stagedApp]);
  await NodeFSP.mkdir(NodePath.dirname(backup), { recursive: true });
  const wasRunning = fresh.desktop.mainPids.length > 0;
  for (const pid of fresh.desktop.mainPids) if (alive(pid)) process.kill(pid, "SIGTERM");
  for (let attempt = 0; attempt < 120 && fresh.desktop.pids.some(alive); attempt++)
    await sleep(500);
  if (fresh.desktop.pids.some(alive))
    throw new Error("Desktop did not stop gracefully; the app has not been replaced");
  await NodeFSP.rename(desktop.appPath, backup);
  let installed = false;
  try {
    await unregisterDesktopCopy(ctx, backup);
    await NodeFSP.rename(ready.stagedApp, desktop.appPath);
    installed = true;
    if (wasRunning) {
      await ctx.run(lsregister, ["-f", desktop.appPath]);
      await ctx.run("open", ["-a", desktop.appPath]);
      let verified = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        const after = await inspect();
        const runtime = await ctx
          .json(NodePath.join(ctx.home, "userdata/server-runtime.json"))
          .catch(() => null);
        if (
          after.desktop?.version === version &&
          after.desktop.backendPids.includes(runtime?.pid)
        ) {
          const response = await fetch(`http://127.0.0.1:${runtime.port}/`, {
            signal: AbortSignal.timeout(1000),
          }).catch(() => null);
          if (response?.ok) {
            verified = true;
            break;
          }
        }
        await sleep(500);
      }
      if (!verified) throw new Error("Updated Desktop backend did not become ready");
    }
    await ctx.writeJson(NodePath.join(ctx.state, "desktop-last-success.json"), {
      version,
      backup,
      completedAt: new Date().toISOString(),
      transaction: ctx.transaction ?? null,
    });
    console.log(
      `${NodeOS.hostname()}: Desktop ${version} patch active${wasRunning ? "" : " on next launch"}`,
    );
  } catch (error) {
    if (installed) {
      const failed = await inspect();
      for (const pid of failed.desktop?.mainPids ?? [])
        if (alive(pid)) process.kill(pid, "SIGTERM");
      for (let attempt = 0; attempt < 120 && (failed.desktop?.pids ?? []).some(alive); attempt++)
        await sleep(500);
      if ((failed.desktop?.pids ?? []).some(alive))
        throw new Error("Desktop rollback waits for shutdown", { cause: error });
      await NodeFSP.rename(desktop.appPath, `${backup}.failed`);
    }
    await NodeFSP.rename(backup, desktop.appPath);
    await ctx.run(lsregister, ["-f", desktop.appPath]);
    if (wasRunning) await ctx.run("open", ["-a", desktop.appPath]);
    throw error;
  }
}
