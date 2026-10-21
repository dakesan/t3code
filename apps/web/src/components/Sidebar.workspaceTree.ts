/**
 * Group an already sorted shelf by workspace key, collecting each group at its
 * first thread. Threads without a key stay on their own.
 */
export function groupSidebarWorkspaces<T>(
  threads: readonly T[],
  keyOf: (thread: T) => string | null,
): T[][] {
  const groups: T[][] = [];
  const byWorkspace = new Map<string, T[]>();
  for (const thread of threads) {
    const key = keyOf(thread);
    const existing = key === null ? undefined : byWorkspace.get(key);
    if (existing) existing.push(thread);
    else {
      const group = [thread];
      groups.push(group);
      if (key !== null) byWorkspace.set(key, group);
    }
  }
  return groups;
}

/**
 * Rewrite saved keys from the earlier per-checkout format, a JSON array of
 * environment, project and path, to the current workspace key. A key that no
 * longer resolves is kept, so the saved place returns when its project does.
 */
export function migrateSidebarWorkspaceOrder(
  order: readonly string[],
  keyOfProject: (environmentId: string, projectId: string) => string | null,
): string[] {
  const migrated: string[] = [];
  const seen = new Set<string>();
  for (const saved of order) {
    const key = saved.startsWith("[") ? (legacyWorkspaceKey(saved, keyOfProject) ?? saved) : saved;
    if (seen.has(key)) continue;
    seen.add(key);
    migrated.push(key);
  }
  return migrated;
}

function legacyWorkspaceKey(
  saved: string,
  keyOfProject: (environmentId: string, projectId: string) => string | null,
): string | null {
  try {
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return null;
    const [environmentId, projectId] = parsed;
    return typeof environmentId === "string" && typeof projectId === "string"
      ? keyOfProject(environmentId, projectId)
      : null;
  } catch {
    return null;
  }
}

/**
 * Put groups the user has ordered in that order. Groups the user never placed
 * stay ahead of them in their incoming (recency) order, so new work shows up
 * at the top until it is dragged somewhere.
 */
export function orderSidebarWorkspaces<T>(
  groups: readonly T[],
  order: readonly string[],
  keyOf: (group: T) => string | null,
): T[] {
  const rank = new Map(order.map((key, index) => [key, index]));
  const unplaced: T[] = [];
  const placed: { group: T; rank: number }[] = [];
  for (const group of groups) {
    const key = keyOf(group);
    const position = key === null ? undefined : rank.get(key);
    if (position === undefined) unplaced.push(group);
    else placed.push({ group, rank: position });
  }
  placed.sort((a, b) => a.rank - b.rank);
  return [...unplaced, ...placed.map((entry) => entry.group)];
}

/** A section's rows as the sidebar shows them: grouped, then groups in saved order. */
export function arrangeSidebarWorkspaces<T>(
  threads: readonly T[],
  order: readonly string[],
  keyOf: (thread: T) => string | null,
): T[] {
  return orderSidebarWorkspaces(groupSidebarWorkspaces(threads, keyOf), order, (group) =>
    keyOf(group[0]!),
  ).flat();
}

/**
 * Whether a section in `threadOrder` already reads as the sidebar arranges it.
 * A drop that fails this would be regrouped away from where it was put.
 */
export function keepsSidebarWorkspaceArrangement(
  threadOrder: readonly string[],
  order: readonly string[],
  keyOf: (thread: string) => string | null,
): boolean {
  return arrangeSidebarWorkspaces(threadOrder, order, keyOf).every(
    (thread, index) => thread === threadOrder[index],
  );
}

/**
 * The saved order after the user drops `activeKey` where `overKey` was in the
 * visible list. Visible keys are written in their new order; saved keys that
 * are not visible right now keep their place relative to each other after them.
 */
export function moveSidebarWorkspace(
  order: readonly string[],
  visibleKeys: readonly string[],
  activeKey: string,
  overKey: string,
): string[] {
  const from = visibleKeys.indexOf(activeKey);
  const to = visibleKeys.indexOf(overKey);
  if (from === -1 || to === -1 || from === to) return [...order];
  const moved = [...visibleKeys];
  moved.splice(from, 1);
  moved.splice(to, 0, activeKey);
  const visible = new Set(moved);
  return [...moved, ...order.filter((key) => !visible.has(key))];
}
