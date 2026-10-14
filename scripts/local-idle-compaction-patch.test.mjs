import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeTest from "node:test";

const script = NodeURL.fileURLToPath(new URL("./local-idle-compaction-patch.mjs", import.meta.url));
const version = "0.0.46-nightly.20261012.3010";
const commit = "a".repeat(40);

function sandbox(context) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-patch-test-"));
  context.after(() => NodeFS.rmSync(root, { recursive: true, force: true }));
  const state = NodePath.join(root, "state");
  const home = NodePath.join(root, "t3");
  NodeFS.mkdirSync(state);
  NodeFS.writeFileSync(
    NodePath.join(state, "config.json"),
    JSON.stringify({ patchCommit: commit }),
  );
  return {
    root,
    state,
    home,
    run: (...args) =>
      NodeChildProcess.spawnSync(process.execPath, [script, ...args], {
        env: { ...process.env, T3_PATCH_STATE_DIR: state, T3CODE_HOME: home },
        encoding: "utf8",
      }),
  };
}

NodeTest.test("an already patched runtime needs no fetch or rebuild", (context) => {
  const box = sandbox(context);
  const target = NodePath.join(box.home, "runtime/versions", version);
  NodeFS.mkdirSync(target, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(target, ".idle-compaction-patch.json"),
    JSON.stringify({ patchCommit: commit }),
  );
  const result = box.run("apply", version);
  NodeAssert.equal(result.status, 0, result.stderr);
  NodeAssert.match(result.stdout, /patch already installed/);
  NodeAssert.equal(NodeFS.existsSync(NodePath.join(box.state, "lock")), false);
});

NodeTest.test("a live builder excludes concurrent patch attempts", (context) => {
  const box = sandbox(context);
  NodeFS.mkdirSync(NodePath.join(box.state, "lock"));
  NodeFS.writeFileSync(
    NodePath.join(box.state, "lock/owner.json"),
    JSON.stringify({ pid: process.pid }),
  );
  const result = box.run("apply", version);
  NodeAssert.equal(result.status, 1, result.stderr);
  NodeAssert.match(result.stderr, /Another patch build/);
  NodeAssert.equal(NodeFS.existsSync(NodePath.join(box.state, "builds")), false);
});

NodeTest.test(
  "a dead builder's lock is recovered and invalid versions leave runtimes untouched",
  (context) => {
    const box = sandbox(context);
    NodeFS.mkdirSync(NodePath.join(box.state, "lock"));
    NodeFS.writeFileSync(
      NodePath.join(box.state, "lock/owner.json"),
      JSON.stringify({ pid: 2147483647 }),
    );
    const result = box.run("apply", "invalid");
    NodeAssert.equal(result.status, 1);
    NodeAssert.match(result.stderr, /Expected an exact nightly version/);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(box.state, "lock")), false);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(box.home, "runtime")), false);
    NodeAssert.equal(
      NodeFS.readdirSync(box.state).some((name) => name.startsWith("lock.stale-")),
      true,
    );
  },
);

NodeTest.test("status exposes pending installation and the last failure", (context) => {
  const box = sandbox(context);
  const staging = NodePath.join(box.root, "staging");
  NodeFS.mkdirSync(staging);
  NodeFS.writeFileSync(
    NodePath.join(box.state, `pending-${version}.json`),
    JSON.stringify({ version, staging, patchCommit: commit }),
  );
  NodeFS.writeFileSync(
    NodePath.join(box.state, "last-error.json"),
    JSON.stringify({ error: "patch conflict" }),
  );
  const result = box.run("status");
  const status = JSON.parse(result.stdout);
  NodeAssert.equal(status.pending[0].version, version);
  NodeAssert.equal(status.lastError.error, "patch conflict");
});
