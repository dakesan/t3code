/** Group an already sorted shelf without merging different environments or projects. */
export function groupSidebarWorkspaces<
  T extends {
    readonly environmentId: string;
    readonly projectId: string;
    readonly worktreePath: string | null;
  },
>(threads: readonly T[], projectRoot: (thread: T) => string | null): T[][] {
  const groups: T[][] = [];
  const byWorkspace = new Map<string, T[]>();
  for (const thread of threads) {
    const path = thread.worktreePath ?? projectRoot(thread);
    // An unknown path cannot establish that two threads share a workspace.
    const key =
      path === null ? null : JSON.stringify([thread.environmentId, thread.projectId, path]);
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
