import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeTest from "node:test";
import {
  activateDesktop,
  desktopProcesses,
  loadAsar,
  repackDesktop,
  repairStagingPath,
  launchRegistryPaths,
} from "./local-idle-compaction-desktop.mjs";

NodeTest.test(
  "staged apps remain outside normal indexing without changing the bundle itself",
  () => {
    const app = "/state/desktop/version/T3 Code (Nightly).app";
    const repaired = repairStagingPath(app);
    NodeAssert.equal(repaired, "/state/desktop/version.noindex/T3 Code (Nightly).app");
    NodeAssert.equal(repairStagingPath(repaired), repaired);
  },
);

NodeTest.test(
  "Launch Services registrations distinguish the installed app and staged copies",
  () => {
    const dump =
      "path:       /Applications/T3 Code (Nightly).app (0x1234)\npath: /state/version.noindex/T3 Code (Nightly).app (0xABCDE)\nname: T3 Code (Nightly)\npath: /state/another.app/Contents/Helper.app (0x7890)\n";
    NodeAssert.deepEqual(launchRegistryPaths(dump), [
      "/Applications/T3 Code (Nightly).app",
      "/state/version.noindex/T3 Code (Nightly).app",
      "/state/another.app/Contents/Helper.app",
    ]);
  },
);

const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));

NodeTest.test("only the selected Nightly app is stopped, including paths with spaces", () => {
  const app = "/Applications/T3 Code (Nightly).app";
  const executable = app + "/Contents/MacOS/T3 Code (Nightly)";
  const info = desktopProcesses(
    [
      { pid: 1, command: executable },
      {
        pid: 2,
        command: `${executable} --require ${app}/Contents/Resources/app.asar/compileCache.cjs ${app}/Contents/Resources/app.asar/apps/server/dist/bin.mjs --bootstrap-fd 3`,
      },
      { pid: 3, command: "/Applications/T3 Code (Alpha).app/Contents/MacOS/T3 Code (Alpha)" },
      { pid: 4, command: `${app}.backup/Contents/MacOS/T3 Code (Nightly)` },
      {
        pid: 5,
        command: `${executable} ${app}/Contents/Resources/app.asar/apps/server/dist/claude-history-worker.mjs`,
      },
    ],
    app,
    executable,
  );
  NodeAssert.deepEqual(info, { pids: [1, 2, 5], mainPids: [1], backendPids: [2] });
});

NodeTest.test("Desktop activation refuses busy work before touching the app", async () => {
  await NodeAssert.rejects(
    activateDesktop({}, "version", { busy: 1 }, () => {}),
    /restart deferred/,
  );
});

NodeTest.test(
  "a local signing decision is required before changing the installed app",
  async () => {
    await NodeAssert.rejects(
      activateDesktop(
        { settings: async () => ({}) },
        "version",
        { busy: 0, desktop: {}, managed: [], service: false },
        () => {},
      ),
      /acceptance is required/,
    );
  },
);

NodeTest.test(
  "repacking updates server and UI assets while retaining Electron native dependencies",
  async (context) => {
    const work = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-desktop-patch-"));
    context.after(() => NodeFSP.rm(work, { recursive: true, force: true }));
    const asar = await loadAsar(root);
    const original = NodePath.join(work, "original");
    const source = NodePath.join(work, "source");
    const app = NodePath.join(work, "T3 Code (Nightly).app");
    const archive = NodePath.join(app, "Contents/Resources/app.asar");
    const native = "node_modules/@native/package+/addon.node";
    const write = async (base, file, text) => {
      const path = NodePath.join(base, file);
      await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
      await NodeFSP.writeFile(path, text);
    };
    await write(original, "package.json", JSON.stringify({ version: "nightly" }));
    await write(original, native, "Electron ABI native binary");
    await write(original, "apps/server/dist/bin.mjs", "old backend");
    await write(original, "apps/server/dist/client/old-hash.js", "old cached client");
    await NodeFSP.mkdir(NodePath.dirname(archive), { recursive: true });
    await asar.createPackageWithOptions(original, archive, { unpack: "**/*.node" });
    await write(source, "apps/server/package.json", JSON.stringify({ version: "nightly" }));
    await write(source, "apps/server/dist/bin.mjs", "patched backend");
    await write(source, "apps/server/dist/client/new-hash.js", "countdown client");
    await repackDesktop(asar, app, source, work);
    asar.uncacheAll();
    NodeAssert.equal(
      asar.extractFile(archive, "apps/server/dist/bin.mjs").toString(),
      "patched backend",
    );
    NodeAssert.deepEqual(
      JSON.parse(asar.extractFile(archive, "package.json").toString()).t3codeWebAuthn,
      { browserPasskeys: false },
    );
    NodeAssert.equal(
      asar.extractFile(archive, "apps/server/dist/client/new-hash.js").toString(),
      "countdown client",
    );
    NodeAssert.equal(
      asar.extractFile(archive, "apps/server/dist/client/old-hash.js").toString(),
      "old cached client",
    );
    NodeAssert.equal(asar.statFile(archive, native, false).unpacked, true);
    NodeAssert.equal(asar.extractFile(archive, native).toString(), "Electron ABI native binary");
  },
);
