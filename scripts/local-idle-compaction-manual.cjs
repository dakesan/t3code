/* oxlint-disable t3code/no-global-process-runtime -- Standalone Electron distribution boundary. */
/* Manual-only update bridge for the fleet-managed Electron distribution. */
const VERSION = /^0\.0\.\d+-nightly\.\d{8}\.\d+$/;

function createManualUpdates({ currentVersion, latest, launch, confirm, publish, readResult }) {
  let state = {
    enabled: true,
    status: "idle",
    channel: "nightly",
    currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };
  let active = false;
  let requestId;
  const set = (next) => {
    state = { ...state, ...next };
    publish(state);
    return state;
  };
  const failure = (error) =>
    set({ status: "error", message: String(error), errorContext: "install", canRetry: true });
  return {
    state: () => state,
    async check() {
      if (active) return { checked: false, state };
      active = true;
      try {
        set({ status: "checking", message: null });
        const version = await latest();
        if (!VERSION.test(version)) throw new Error("Invalid Nightly release version");
        set({
          status: version === currentVersion ? "up-to-date" : "available",
          availableVersion: version === currentVersion ? null : version,
          checkedAt: new Date().toISOString(),
        });
        return { checked: true, state };
      } catch (error) {
        failure(error);
        return { checked: false, state };
      } finally {
        active = false;
      }
    },
    async deploy() {
      if (active || !VERSION.test(state.availableVersion ?? ""))
        return { accepted: false, completed: false, state };
      active = true;
      try {
        const version = state.availableVersion;
        if (!(await confirm(version))) return { accepted: false, completed: false, state };
        requestId = await launch(version);
        set({
          status: "downloading",
          downloadPercent: null,
          message:
            "Preparing patched Nightly and deploying to all four computers. T3 will restart when all agents are idle.",
        });
        return { accepted: true, completed: false, state };
      } catch (error) {
        active = false;
        failure(error);
        return { accepted: false, completed: false, state };
      } finally {
        if (state.status !== "downloading") active = false;
      }
    },
    async refresh() {
      if (!active || state.status !== "downloading") return;
      try {
        const result = await readResult();
        if (requestId && result?.requestId !== requestId) return;
        if (result?.version !== state.availableVersion) return;
        if (result.error) {
          active = false;
          failure(result.error);
        } else if (result.completedAt) {
          active = false;
          set({ status: "up-to-date", message: "Fleet deployment completed." });
        }
      } catch {
        /* A temporary SSH failure must not launch another deployment. */
      }
    },
  };
}

function install(electron, deps = {}) {
  const { execFile } = require("node:child_process");
  const ssh = (command) =>
    new Promise((resolve, reject) => {
      execFile(
        "/usr/bin/ssh",
        [
          "-T",
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=10",
          "-o",
          "ServerAliveInterval=15",
          "-o",
          "ServerAliveCountMax=2",
          "Logomix",
          command,
        ],
        { timeout: 45000, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) =>
          error ? reject(new Error(stderr || error.message)) : resolve(stdout),
      );
    });
  let base = {
    hostArch: require("node:os").arch(),
    appArch: process.arch,
    runningUnderArm64Translation: false,
  };
  const merged = () => ({ ...base, ...updates.state() });
  const updates = createManualUpdates({
    currentVersion: electron.app.getVersion(),
    latest: async () => {
      const response = await fetch(
        "https://api.github.com/repos/pingdotgg/t3code/releases?per_page=30",
        { signal: AbortSignal.timeout(20000) },
      );
      if (!response.ok) throw new Error(`Release check failed: HTTP ${response.status}`);
      const releases = await response.json();
      const release = releases.find((r) => !r.draft && VERSION.test(r.tag_name?.replace(/^v/, "")));
      if (!release) throw new Error("No Nightly release found");
      return release.tag_name.replace(/^v/, "");
    },
    confirm: async (version) =>
      (
        await electron.dialog.showMessageBox({
          type: "question",
          title: "Update T3 Code on all computers",
          message: `Prepare and deploy Nightly ${version}?`,
          detail:
            "The local patch will be applied. T3 Code on MacBook, Mac mini, myhome and Logomix will restart only after every agent is idle. No scheduled retry will run if deployment is blocked.",
          buttons: ["Cancel", "Prepare and deploy"],
          defaultId: 0,
          cancelId: 0,
        })
      ).response === 1,
    launch: async (version) => {
      const id = require("node:crypto").randomUUID();
      await ssh(
        'export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"; ' +
          "systemd-run --user --collect --unit=t3-manual-update " +
          '--property=TimeoutStartSec=8h --setenv=PATH="$PATH" ' +
          '"$(command -v node)" "$HOME/ghq/github.com/pingdotgg/t3code/scripts/local-idle-compaction-patch.mjs" manual-update ' +
          version +
          " --request=" +
          id,
      );
      return id;
    },
    readResult: async () =>
      JSON.parse(await ssh("cat ~/.local/share/t3-nightly-patch/manual-last.json")),
    publish: () => {
      for (const win of electron.BrowserWindow.getAllWindows())
        win.webContents.send("desktop:update-state", merged());
    },
    ...deps,
  });
  const originalHandle = electron.ipcMain.handle.bind(electron.ipcMain);
  electron.ipcMain.handle = (channel, handler) => {
    if (channel === "desktop:update-get-state")
      return originalHandle(channel, async (...args) => {
        base = await handler(...args);
        return merged();
      });
    if (channel === "desktop:update-check")
      return originalHandle(channel, async () => {
        const result = await updates.check();
        return { ...result, state: merged() };
      });
    if (["desktop:update-download", "desktop:update-install"].includes(channel))
      return originalHandle(channel, async () => ({
        ...(await updates.deploy()),
        state: merged(),
      }));
    if (channel === "desktop:update-set-channel") return originalHandle(channel, () => merged());
    return originalHandle(channel, handler);
  };
  electron.app.on("web-contents-created", (_event, contents) => {
    const send = contents.send.bind(contents);
    contents.send = (channel, ...args) => {
      if (channel === "desktop:update-state") base = { ...base, ...args[0] };
      return send(channel, ...(channel === "desktop:update-state" ? [merged()] : args));
    };
  });
  const buildMenu = electron.Menu.buildFromTemplate.bind(electron.Menu);
  electron.Menu.buildFromTemplate = (template) => {
    const visit = (items) =>
      items.map((item) => ({
        ...item,
        ...(typeof item.label === "string" && /check for updates/i.test(item.label)
          ? {
              label: "Check for Fleet Updates…",
              enabled: true,
              click: async () => {
                await updates.check();
                if (updates.state().status === "available") await updates.deploy();
                else
                  await electron.dialog.showMessageBox({
                    message:
                      updates.state().message ??
                      `T3 Code ${electron.app.getVersion()} is up to date.`,
                  });
              },
            }
          : {}),
        ...(Array.isArray(item.submenu) ? { submenu: visit(item.submenu) } : {}),
      }));
    return buildMenu(visit(template));
  };
  // Observe only an explicitly requested deployment; never check or deploy on a timer.
  const timer = setInterval(() => {
    void updates.refresh();
  }, 10000);
  timer.unref();
  return updates;
}

module.exports = { createManualUpdates, install };
