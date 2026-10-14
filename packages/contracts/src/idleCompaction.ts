import * as DateTime from "effect/DateTime";
import type { OrchestrationV2ThreadProjection } from "./orchestrationV2.ts";
import { isProviderNativeSubagentThread } from "./orchestrationV2.ts";

/** Fixed local policy. Maintenance turns never extend the prompt's deadline. */
export function idleCompactionDelayMs(provider: string): number | null {
  return provider === "claudeAgent" ? 54 * 60_000 : provider === "codex" ? 25 * 60_000 : null;
}

export function idleCompactionState(projection: OrchestrationV2ThreadProjection) {
  const { thread } = projection;
  if (thread.archivedAt !== null || thread.deletedAt !== null) return null;
  if (thread.settledOverride === "settled" || thread.settledAt != null) return null;
  if (isProviderNativeSubagentThread(thread)) return null;
  const provider = projection.providerThreads.find(
    (item) => item.id === thread.activeProviderThreadId,
  );
  const delay = provider ? idleCompactionDelayMs(provider.driver) : null;
  if (delay === null) return null;
  const prompt = projection.messages
    .filter(
      (message) =>
        message.role === "user" &&
        message.createdBy === "user" &&
        message.text.trim().toLowerCase() !== "/compact",
    )
    .reduce<OrchestrationV2ThreadProjection["messages"][number] | null>(
      (last, message) =>
        !last || DateTime.toEpochMillis(message.updatedAt) > DateTime.toEpochMillis(last.updatedAt)
          ? message
          : last,
      null,
    );
  if (!prompt) return null;
  const promptAt = DateTime.toEpochMillis(prompt.updatedAt);
  // Persisted maintenance messages also suppress retries after a failed compact or a restart.
  if (
    projection.messages.some(
      (message) =>
        message.role === "user" &&
        message.text.trim().toLowerCase() === "/compact" &&
        DateTime.toEpochMillis(message.createdAt) >= promptAt,
    )
  )
    return null;
  if (
    projection.turnItems.some(
      (item) =>
        item.type === "compaction" &&
        item.providerThreadId === thread.activeProviderThreadId &&
        item.status === "completed" &&
        DateTime.toEpochMillis(item.completedAt ?? item.updatedAt) >= promptAt,
    )
  )
    return null;
  const blocked =
    projection.runs.some((run) =>
      ["queued", "preparing", "starting", "running", "waiting", "finalizing"].includes(run.status),
    ) ||
    projection.runtimeRequests.some((request) => request.status === "pending") ||
    projection.nodes.some((node) => ["pending", "running", "waiting"].includes(node.status)) ||
    projection.subagents.some((agent) => ["pending", "running", "waiting"].includes(agent.status));
  return { promptAt, deadline: promptAt + delay, blocked };
}

/** Null outside the warning window. Zero means the deadline has passed. */
export function idleCompactionMinutesRemaining(deadline: number, now: number): number | null {
  const remaining = deadline - now;
  return remaining < 10 * 60_000 ? Math.max(0, Math.ceil(remaining / 60_000)) : null;
}
