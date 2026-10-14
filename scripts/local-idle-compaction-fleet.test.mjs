import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeTest from "node:test";
import { assertReady, fleetTransaction, quote } from "./local-idle-compaction-fleet.mjs";

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
