import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeTest from "node:test";
import * as NodeHttp from "node:http";
import {
  assertReady,
  fleetTransaction,
  quote,
  countActiveWork,
  activationVerified,
  activateLocal,
} from "./local-idle-compaction-fleet.mjs";

NodeTest.test("an already current live service is not restarted", async (t) => {
  const version = "0.0.46-nightly.20261014.3118";
  const server = NodeHttp.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ serverVersion: version, environmentId: "fixture" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const commands = [];
  const ctx = {
    home: "/fixture",
    state: "/fixture/state",
    versions: "/fixture/runtime/versions",
    markerName: "marker.json",
    settings: async () => ({}),
    samePatch: async () => true,
    exists: async (path) => path.endsWith("service.plist") || path.endsWith("t3code.service"),
    json: async (path) => {
      if (path.endsWith("service-state.json")) return { activeVersion: version };
      if (path.endsWith("server-runtime.json"))
        return { pid: process.pid, port: server.address().port, serviceManaged: true };
      if (path.endsWith("marker.json")) return {};
      throw new Error("Fixture path not found");
    },
    run: async (command) => {
      commands.push(command);
      if (command === "ps") return `${process.pid} /fixture/runtime/versions/${version}/t3 serve`;
      throw new Error("A current service must not run a mutation command");
    },
  };
  const result = await activateLocal(ctx, version);
  NodeAssert.equal(result.serviceEndpoint.version, version);
  NodeAssert.deepEqual(commands, ["ps"]);
});

NodeTest.test(
  "service readiness requires the live descriptor, regardless of process counts",
  () => {
    const before = { service: true, managed: [], serverPids: [1, 2] };
    NodeAssert.equal(
      activationVerified({ serviceVersion: "new", managed: [], serverPids: [] }, before, "new"),
      false,
    );
    NodeAssert.equal(
      activationVerified(
        {
          serviceVersion: "new",
          serviceEndpoint: { version: "old" },
          managed: [],
          serverPids: [3, 4],
        },
        before,
        "new",
      ),
      false,
    );
    NodeAssert.equal(
      activationVerified(
        {
          serviceVersion: "new",
          serviceEndpoint: { version: "new" },
          managed: [],
          serverPids: [3],
        },
        before,
        "new",
      ),
      true,
    );
  },
);

NodeTest.test("every managed SSH port must report the selected version", () => {
  const before = { service: false, managed: [{ root: "r", port: 3774 }] };
  const after = {
    managed: [{ root: "r", port: 3774, version: "new", endpoint: { version: "old" } }],
  };
  NodeAssert.equal(activationVerified(after, before, "new"), false);
  after.managed[0].endpoint.version = "new";
  NodeAssert.equal(activationVerified(after, before, "new"), true);
  after.managed[0].port = 3775;
  NodeAssert.equal(activationVerified(after, before, "new"), false);
});

NodeTest.test(
  "stale subagent projections cannot permanently block restarts, while live and unknown work does",
  async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(
        "CREATE TABLE orchestration_v2_projection_runs (run_id TEXT, thread_id TEXT, status TEXT); CREATE TABLE orchestration_v2_projection_runtime_requests (status TEXT); CREATE TABLE orchestration_v2_projection_subagents (run_id TEXT, child_thread_id TEXT, status TEXT)",
      );
      db.exec(
        "INSERT INTO orchestration_v2_projection_runs VALUES ('parent','thread','completed'); INSERT INTO orchestration_v2_projection_subagents VALUES ('parent','child','running')",
      );
      NodeAssert.equal(countActiveWork(db), 0);
      db.exec("UPDATE orchestration_v2_projection_runs SET status='running'");
      NodeAssert.ok(countActiveWork(db) > 0);
      db.exec(
        "UPDATE orchestration_v2_projection_runs SET status='completed'; INSERT INTO orchestration_v2_projection_runs VALUES ('child-run','child','running')",
      );
      NodeAssert.ok(countActiveWork(db) > 0);
      db.exec(
        "UPDATE orchestration_v2_projection_runs SET status='completed'; DELETE FROM orchestration_v2_projection_runs WHERE run_id='parent'",
      );
      NodeAssert.equal(countActiveWork(db), 1);
      db.exec(
        "DELETE FROM orchestration_v2_projection_subagents; INSERT INTO orchestration_v2_projection_runtime_requests VALUES ('pending')",
      );
      NodeAssert.equal(countActiveWork(db), 1);
    } finally {
      db.close();
    }
  },
);

NodeTest.test("remote arguments remain literal shell data", () => {
  const value = "path with ' quotes $(exit 17) `exit 19`\nsecond line";
  const result = NodeChildProcess.spawnSync("sh", ["-c", `printf %s ${quote(value)}`], {
    encoding: "utf8",
  });
  NodeAssert.equal(result.status, 0);
  NodeAssert.equal(result.stdout, value);
});

NodeTest.test("an offline node prevents every build and activation", async () => {
  const events = [];
  await NodeAssert.rejects(
    fleetTransaction(
      ["online", "offline"],
      async () => events.push("build"),
      async (node) => {
        if (node === "offline") throw new Error("offline");
      },
      async () => events.push("restart"),
    ),
    /offline/,
  );
  NodeAssert.deepEqual(events, []);
});

NodeTest.test("preflight reports every blocked node before returning", async () => {
  const inspected = [];
  await NodeAssert.rejects(
    fleetTransaction(
      ["busy", "desktop"],
      async () => {},
      async (node) => {
        await Promise.resolve();
        inspected.push(node);
        throw new Error(node === "busy" ? "Active agent work" : "Desktop backend");
      },
      async () => {},
    ),
    (error) => {
      NodeAssert.match(error.message, /busy: Error: Active agent work/);
      NodeAssert.match(error.message, /desktop: Error: Desktop backend/);
      return true;
    },
  );
  NodeAssert.deepEqual(inspected, ["busy", "desktop"]);
});

NodeTest.test("a patch conflict leaves every server running its former version", async () => {
  const active = [];
  await NodeAssert.rejects(
    fleetTransaction(
      ["a", "b"],
      async (node) => {
        if (node === "b") throw new Error("patch conflict");
      },
      async () => {},
      async (node) => active.push(node),
    ),
    /patch conflict/,
  );
  NodeAssert.deepEqual(active, []);
});

NodeTest.test("work starting during the builds prevents restart", async () => {
  let built = false;
  const active = [];
  await NodeAssert.rejects(
    fleetTransaction(
      ["a"],
      async () => {
        built = true;
      },
      async () => {
        if (built) assertReady({ service: true, managed: [], busy: 1 });
      },
      async (node) => active.push(node),
    ),
    /Active agent work/,
  );
  NodeAssert.deepEqual(active, []);
});

NodeTest.test("all builds finish before any server is restarted", async () => {
  const events = [];
  await fleetTransaction(
    ["a", "b"],
    async (node) => {
      events.push(`build ${node}`);
    },
    async () => {},
    async (node) => {
      events.push(`restart ${node}`);
    },
  );
  NodeAssert.deepEqual(events, ["build a", "build b", "restart a", "restart b"]);
});

NodeTest.test("a later activation failure restores earlier nodes in reverse order", async () => {
  const events = [];
  await NodeAssert.rejects(
    fleetTransaction(
      ["a", "b", "c"],
      async () => {},
      async () => {},
      async (node) => {
        events.push(`activate ${node}`);
        if (node === "c") throw new Error("startup failed");
      },
      () => ["a", "b", "c"],
      async (node) => events.push(`restore ${node}`),
    ),
    /startup failed/,
  );
  NodeAssert.deepEqual(events, [
    "activate a",
    "activate b",
    "activate c",
    "restore c",
    "restore b",
    "restore a",
  ]);
});

NodeTest.test("rollback continues after a restore fails and reports both errors", async () => {
  const restored = [];
  await NodeAssert.rejects(
    fleetTransaction(
      ["a", "b", "c"],
      async () => {},
      async () => {},
      async (node) => {
        if (node === "c") throw new Error("startup failed");
      },
      () => ["a", "b", "c"],
      async (node) => {
        restored.push(node);
        if (node === "b") throw new Error("restore offline");
      },
    ),
    (error) => {
      NodeAssert.ok(error instanceof AggregateError);
      NodeAssert.match(error.message, /startup failed/);
      NodeAssert.match(error.message, /restore offline/);
      return true;
    },
  );
  NodeAssert.deepEqual(restored, ["c", "b", "a"]);
});

NodeTest.test(
  "Desktop activation can precede remote server restarts without changing build order",
  async () => {
    const events = [];
    await fleetTransaction(
      ["cli", "desktop"],
      async (node) => events.push(`build ${node}`),
      async () => {},
      async (node) => events.push(`activate ${node}`),
      () => ["desktop", "cli"],
    );
    NodeAssert.deepEqual(events, [
      "build cli",
      "build desktop",
      "activate desktop",
      "activate cli",
    ]);
  },
);

NodeTest.test("Desktop and unknown launch methods cannot be reported as patched", () => {
  NodeAssert.throws(
    () => assertReady({ desktop: true, service: true, managed: [], busy: 0 }),
    /Desktop/,
  );
  NodeAssert.throws(
    () => assertReady({ desktop: false, service: false, managed: [], busy: 0 }),
    /No supported/,
  );
  assertReady({ desktop: false, service: true, managed: [], busy: 0 });
});
