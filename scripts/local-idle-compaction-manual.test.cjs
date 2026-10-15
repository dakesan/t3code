const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createManualUpdates } = require("./local-idle-compaction-manual.cjs");
const currentVersion = "0.0.46-nightly.20261015.3158";
const target = "0.0.46-nightly.20261015.3171";
function harness(overrides = {}) {
  const calls = [];
  const updates = createManualUpdates({
    currentVersion,
    latest: async () => {
      calls.push("check");
      return target;
    },
    launch: async (version) => {
      calls.push(version);
    },
    confirm: async () => true,
    publish: () => {},
    readResult: async () => null,
    ...overrides,
  });
  return { calls, updates };
}
test("startup, refresh and release checks never deploy", async () => {
  const { calls, updates } = harness();
  assert.deepEqual(calls, []);
  await updates.refresh();
  await updates.check();
  assert.deepEqual(calls, ["check"]);
  assert.equal(updates.state().status, "available");
});
test("cancel leaves every computer unchanged", async () => {
  const { calls, updates } = harness({ confirm: async () => false });
  await updates.check();
  assert.equal((await updates.deploy()).accepted, false);
  assert.deepEqual(calls, ["check"]);
});
test("explicit consent deploys the checked version once despite duplicate clicks", async () => {
  const { calls, updates } = harness();
  await updates.check();
  const results = await Promise.all([updates.deploy(), updates.deploy()]);
  assert.equal(results.filter((r) => r.accepted).length, 1);
  await updates.refresh();
  assert.deepEqual(calls, ["check", target]);
});
test("blocked deployment becomes retryable without automatic retries", async () => {
  const { calls, updates } = harness({
    readResult: async () => ({ version: target, error: "Active agent work" }),
  });
  await updates.check();
  await updates.deploy();
  await updates.refresh();
  await updates.refresh();
  assert.equal(updates.state().status, "error");
  assert.match(updates.state().message, /Active agent work/);
  assert.deepEqual(calls, ["check", target]);
});
test("invalid release data cannot reach the deployment command", async () => {
  const { calls, updates } = harness({ latest: async () => "bad;command" });
  await updates.check();
  assert.equal((await updates.deploy()).accepted, false);
  assert.deepEqual(calls, []);
});
test("an already current installation does not deploy", async () => {
  const { calls, updates } = harness({ latest: async () => currentVersion });
  await updates.check();
  assert.equal(updates.state().status, "up-to-date");
  assert.equal((await updates.deploy()).accepted, false);
  assert.deepEqual(calls, []);
});

test("Electron IPC serves enabled manual controls and never invokes the native updater", async () => {
  const { install } = require("./local-idle-compaction-manual.cjs");
  const handlers = new Map();
  const calls = [];
  const electron = {
    app: { getVersion: () => currentVersion, on: () => {} },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    Menu: { buildFromTemplate: (template) => template },
    BrowserWindow: { getAllWindows: () => [] },
    dialog: { showMessageBox: async () => ({ response: 0 }) },
  };
  install(electron, {
    latest: async () => target,
    launch: async () => calls.push("deploy"),
    confirm: async () => false,
  });
  for (const channel of ["get-state", "check", "download", "install"])
    electron.ipcMain.handle("desktop:update-" + channel, async () => {
      calls.push("native");
      return { enabled: false, status: "disabled", hostArch: "arm64" };
    });
  assert.equal((await handlers.get("desktop:update-get-state")()).enabled, true);
  assert.equal((await handlers.get("desktop:update-check")()).state.status, "available");
  assert.equal((await handlers.get("desktop:update-download")()).accepted, false);
  assert.deepEqual(calls, ["native"]);
  const menu = electron.Menu.buildFromTemplate([
    { label: "App", submenu: [{ label: "Check for Updates…" }] },
  ]);
  assert.equal(menu[0].submenu[0].enabled, true);
  assert.match(menu[0].submenu[0].label, /Fleet/);
});
