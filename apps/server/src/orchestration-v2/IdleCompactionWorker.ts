import { CommandId, idleCompactionDelayMs, idleCompactionState } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

// The shared scheduler survives disconnected clients. Commands are conditional
// and maintenance messages persist the attempt, including across server restarts.
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const registry = yield* ProviderAdapterRegistry.ProviderAdapterRegistryV2;
    const scheduler = yield* Scheduler.Scheduler;
    // Restarting or upgrading must never wake historical conversations.
    const startedAt = DateTime.toEpochMillis(yield* DateTime.now);
    const handled = new Map<string, number>();
    yield* scheduler.register(
      "idle-compaction",
      Effect.gen(function* () {
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const snapshot = yield* projections.getShellSnapshot({ location: "active" });
        const providers = new Map<string, number | null>();
        for (const thread of snapshot.threads) {
          if (
            thread.activeRunId !== null ||
            thread.pendingRuntimeRequest !== null ||
            !thread.latestUserAuthoredMessageAt
          )
            continue;
          if (!providers.has(thread.providerInstanceId)) {
            const adapter = yield* registry.get(thread.providerInstanceId).pipe(Effect.option);
            providers.set(
              thread.providerInstanceId,
              adapter._tag === "Some" ? idleCompactionDelayMs(adapter.value.driver) : null,
            );
          }
          const delay = providers.get(thread.providerInstanceId);
          const promptAt = DateTime.toEpochMillis(thread.latestUserAuthoredMessageAt);
          if (
            promptAt <= startedAt ||
            delay == null ||
            promptAt + delay > now ||
            handled.get(thread.id) === promptAt
          )
            continue;
          const projection = yield* threads.getThreadProjection(thread.id);
          const state = idleCompactionState(projection);
          if (!state) {
            handled.set(thread.id, promptAt);
            continue;
          }
          if (state.blocked) continue;
          yield* threads
            .dispatch({
              type: "thread.idle-compact",
              commandId: CommandId.make(`idle-compact-check:${thread.id}:${now}`),
              threadId: thread.id,
              promptAt,
            })
            .pipe(
              Effect.tap((result) => {
                if (result.storedEvents.length > 0) handled.set(thread.id, promptAt);
                return Effect.void;
              }),
              Effect.catchCause((cause) =>
                Effect.logWarning("Idle compaction dispatch failed", {
                  threadId: thread.id,
                  cause,
                }),
              ),
            );
        }
      }),
    );
  }),
);
