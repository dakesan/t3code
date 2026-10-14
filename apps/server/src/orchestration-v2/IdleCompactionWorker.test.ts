import { assert, it } from "@effect/vitest";
import {
  ThreadId,
  ProviderInstanceId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShellSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Worker from "./IdleCompactionWorker.ts";

it.effect(
  "compacts all due idle threads without a client and remembers persisted attempts after restart",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        let sweep: Effect.Effect<void> = Effect.die("Scheduler was not registered");
        const commands: string[] = [];
        const compacted = new Set<string>();
        const shell = ["codex", "claudeAgent"].map((driver) => ({
          id: ThreadId.make(driver),
          providerInstanceId: ProviderInstanceId.make(driver),
          latestUserAuthoredMessageAt: DateTime.makeUnsafe(0),
          activeRunId: null,
          pendingRuntimeRequest: null,
        }));
        const dependencies = Layer.mergeAll(
          Layer.succeed(Scheduler.Scheduler, {
            register: (_name, run) =>
              Effect.gen(function* () {
                const context = yield* Effect.context<Effect.Services<typeof run>>();
                sweep = Effect.provideContext(run, context).pipe(Effect.orDie);
              }),
          }),
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getShellSnapshot: () =>
              Effect.succeed({ threads: shell } as unknown as OrchestrationV2ThreadShellSnapshot),
          }),
          Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({
            get: (id) =>
              Effect.succeed({
                driver: id,
              } as unknown as ProviderAdapter.ProviderAdapterV2["Service"]),
          }),
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadProjection: (id) =>
              Effect.succeed({
                thread: {
                  activeProviderThreadId: id,
                  lineage: { relationshipToParent: null },
                  archivedAt: null,
                  deletedAt: null,
                },
                providerThreads: [{ id, driver: id }],
                messages: [
                  {
                    role: "user",
                    createdBy: "user",
                    text: "Work",
                    createdAt: DateTime.makeUnsafe(0),
                    updatedAt: DateTime.makeUnsafe(0),
                  },
                  ...(compacted.has(id)
                    ? [
                        {
                          role: "user",
                          text: "/compact",
                          createdBy: "system",
                          createdAt: DateTime.makeUnsafe(1),
                          updatedAt: DateTime.makeUnsafe(1),
                        },
                      ]
                    : []),
                ],
                runs: [],
                nodes: [],
                runtimeRequests: [],
                subagents: [],
                turnItems: [],
              } as unknown as OrchestrationV2ThreadProjection),
            dispatch: (command) => {
              if ("threadId" in command) {
                commands.push(command.threadId);
                compacted.add(command.threadId);
              }
              return Effect.succeed({ sequence: 1, storedEvents: [] });
            },
          }),
        );
        yield* Layer.build(Worker.layer.pipe(Layer.provide(dependencies)));
        yield* TestClock.adjust("24 minutes");
        yield* sweep;
        assert.deepEqual(commands, []);
        yield* TestClock.adjust("1 minute");
        yield* sweep;
        assert.deepEqual(commands, ["codex"]);
        yield* TestClock.adjust("29 minutes");
        yield* sweep;
        assert.deepEqual(commands, ["codex", "claudeAgent"]);
        // A new worker's in-memory map is empty; the maintenance messages survive it.
        yield* Layer.build(Worker.layer.pipe(Layer.provide(dependencies)));
        yield* sweep;
        assert.deepEqual(commands, ["codex", "claudeAgent"]);
      }),
    ),
);
