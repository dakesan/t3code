type WorkspaceThread = {
  readonly environmentId: string;
  readonly projectId: string;
  readonly worktreePath: string | null;
};

/** The identity of a thread's workspace, or null when its path is unknown. */
export function sidebarWorkspaceKey<T extends WorkspaceThread>(
  thread: T,
  projectRoot: (thread: T) => string | null,
): string | null {
  const path = thread.worktreePath ?? projectRoot(thread);
  // An unknown path cannot establish that two threads share a workspace.
  return path === null ? null : JSON.stringify([thread.environmentId, thread.projectId, path]);
}

/** Group an already sorted shelf without merging different environments or projects. */
export function groupSidebarWorkspaces<T extends WorkspaceThread>(
  threads: readonly T[],
  projectRoot: (thread: T) => string | null,
): T[][] {
  const groups: T[][] = [];
  const byWorkspace = new Map<string, T[]>();
  for (const thread of threads) {
    const key = sidebarWorkspaceKey(thread, projectRoot);
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
