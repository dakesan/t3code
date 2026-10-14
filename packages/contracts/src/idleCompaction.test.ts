import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import {
  idleCompactionDelayMs,
  idleCompactionState,
  idleCompactionMinutesRemaining,
} from "./idleCompaction.ts";
import type { OrchestrationV2ThreadProjection } from "./orchestrationV2.ts";

const at = (minutes: number) => DateTime.makeUnsafe(minutes * 60_000);
function projection(driver = "codex") {
  return {
    thread: {
      activeProviderThreadId: "provider",
      lineage: { relationshipToParent: null },
      archivedAt: null,
      deletedAt: null,
      settledOverride: null,
      settledAt: null,
    },
    providerThreads: [{ id: "provider", driver }],
    messages: [
      { role: "user", createdBy: "user", text: "Work", createdAt: at(0), updatedAt: at(0) },
    ],
    turnItems: [],
    runs: [],
    nodes: [],
    runtimeRequests: [],
    subagents: [],
  } as unknown as {
    -readonly [K in keyof OrchestrationV2ThreadProjection]: OrchestrationV2ThreadProjection[K];
  };
}

describe("idle compaction policy", () => {
  it.each([
    ["codex", 25],
    ["claudeAgent", 54],
  ])("sets %s's deadline from the last prompt, without a token threshold", (driver, minutes) => {
    const state = idleCompactionState(projection(driver));
    expect(state?.deadline).toBe(minutes * 60_000);
    expect(state?.blocked).toBe(false);
  });
  it("leaves other providers unchanged", () => {
    expect(idleCompactionDelayMs("opencode")).toBeNull();
    expect(idleCompactionState(projection("opencode"))).toBeNull();
  });
  it("resets on a new user prompt but not a system wake", () => {
    const state = projection();
    const first = state.messages[0]!;
    state.messages = [
      ...state.messages,
      { ...first, createdBy: "system", updatedAt: at(20), createdAt: at(20) },
    ];
    expect(idleCompactionState(state)?.deadline).toBe(25 * 60_000);
    state.messages = [...state.messages, { ...first, updatedAt: at(22), createdAt: at(22) }];
    expect(idleCompactionState(state)?.deadline).toBe(47 * 60_000);
  });
  it("does not repeat maintenance, including after restart or a failed attempt", () => {
    const state = projection();
    state.messages = [
      ...state.messages,
      {
        ...state.messages[0]!,
        createdBy: "system",
        text: "/compact",
        createdAt: at(25),
        updatedAt: at(25),
      },
    ];
    expect(idleCompactionState(state)).toBeNull();
    state.messages = [
      ...state.messages,
      { ...state.messages[0]!, createdAt: at(30), updatedAt: at(30) },
    ];
    expect(idleCompactionState(state)?.deadline).toBe(55 * 60_000);
  });
  it.each(["runs", "nodes", "runtimeRequests", "subagents"] as const)(
    "defers while %s contain active work",
    (field) => {
      const state = projection();
      Object.assign(state, {
        [field]: [{ status: field === "runtimeRequests" ? "pending" : "running" }],
      });
      expect(idleCompactionState(state)?.blocked).toBe(true);
    },
  );
  it("does not touch archived or empty conversations", () => {
    const state = projection();
    state.messages = [];
    expect(idleCompactionState(state)).toBeNull();
    expect(
      idleCompactionState({
        ...projection(),
        thread: { ...projection().thread, archivedAt: at(1) },
      }),
    ).toBeNull();
  });
  it.each([
    { settledOverride: "settled", settledAt: null },
    { settledOverride: null, settledAt: at(1) },
  ] as const)("leaves settled threads untouched: %o", (settlement) => {
    const state = projection();
    expect(
      idleCompactionState({ ...state, thread: { ...state.thread, ...settlement } }),
    ).toBeNull();
  });
  it("does not compact a provider session already compacted after its prompt", () => {
    const state = projection();
    Object.assign(state, {
      turnItems: [
        {
          type: "compaction",
          providerThreadId: "provider",
          status: "completed",
          completedAt: at(1),
          updatedAt: at(1),
        },
      ],
    });
    expect(idleCompactionState(state)).toBeNull();
  });
  it("shows a countdown only below ten minutes and clamps overdue time", () => {
    expect(idleCompactionMinutesRemaining(25 * 60_000, 15 * 60_000)).toBeNull();
    expect(idleCompactionMinutesRemaining(25 * 60_000, 15 * 60_000 + 1)).toBe(10);
    expect(idleCompactionMinutesRemaining(25 * 60_000, 16 * 60_000)).toBe(9);
    expect(idleCompactionMinutesRemaining(25 * 60_000, 30 * 60_000)).toBe(0);
  });
});
