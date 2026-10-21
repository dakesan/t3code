import { describe, expect, it } from "vite-plus/test";
import {
  groupSidebarWorkspaces,
  keepsSidebarWorkspaceArrangement,
  migrateSidebarWorkspaceOrder,
  moveSidebarWorkspace,
  orderSidebarWorkspaces,
} from "./Sidebar.workspaceTree";

const group = (threads: readonly { id: string; key: string | null }[]) =>
  groupSidebarWorkspaces(threads, (thread) => thread.key).map((items) =>
    items.map((item) => item.id),
  );

describe("groupSidebarWorkspaces", () => {
  it("collects matching keys at their first appearance and preserves child order", () => {
    expect(
      group([
        { id: "a", key: "repo" },
        { id: "b", key: "other" },
        { id: "c", key: "repo" },
      ]),
    ).toEqual([["a", "c"], ["b"]]);
  });
  it("does not combine threads without a key", () => {
    expect(
      group([
        { id: "a", key: null },
        { id: "b", key: null },
      ]),
    ).toEqual([["a"], ["b"]]);
  });
  it("handles empty lists and singleton workspaces", () => {
    expect(group([])).toEqual([]);
    expect(group([{ id: "a", key: "repo" }])).toEqual([["a"]]);
  });
});

describe("migrateSidebarWorkspaceOrder", () => {
  const keyOfProject = (environmentId: string, projectId: string) =>
    projectId === "gone" ? null : `repo-of-${projectId}`;
  it("rewrites per-checkout keys and keeps the first place of keys that now coincide", () => {
    expect(
      migrateSidebarWorkspaceOrder(
        [
          JSON.stringify(["macbook", "dotfiles", "/Users/me/dotfiles"]),
          "repo-of-pipeline",
          JSON.stringify(["server", "dotfiles", "/home/me/dotfiles"]),
          JSON.stringify(["server", "pipeline", "/home/me/.t3/worktrees/pipeline/exp01"]),
        ],
        keyOfProject,
      ),
    ).toEqual(["repo-of-dotfiles", "repo-of-pipeline"]);
  });
  it("keeps keys it cannot resolve", () => {
    const unresolved = JSON.stringify(["macbook", "gone", "/gone"]);
    expect(migrateSidebarWorkspaceOrder([unresolved, "[broken"], keyOfProject)).toEqual([
      unresolved,
      "[broken",
    ]);
  });
});

describe("orderSidebarWorkspaces", () => {
  const keyOf = (group: string) => group;
  it("keeps unplaced groups first in incoming order, then placed groups by saved rank", () => {
    expect(orderSidebarWorkspaces(["new", "b", "a", "newer"], ["a", "b"], keyOf)).toEqual([
      "new",
      "newer",
      "a",
      "b",
    ]);
  });
  it("leaves groups without a key where unplaced groups go", () => {
    expect(orderSidebarWorkspaces<string | null>(["a", null], ["a"], (group) => group)).toEqual([
      null,
      "a",
    ]);
  });
});

describe("keepsSidebarWorkspaceArrangement", () => {
  // Threads are named by their workspace: "s1" belongs to "s", "x" is alone.
  const keyOf = (thread: string) => thread[0]!;
  it("accepts a reorder inside a folder", () => {
    expect(keepsSidebarWorkspaceArrangement(["s1", "s2", "g2", "g1"], ["s", "g"], keyOf)).toBe(
      true,
    );
  });
  it("rejects a slot inside another folder", () => {
    expect(keepsSidebarWorkspaceArrangement(["s1", "g2", "s2", "g1"], ["s", "g"], keyOf)).toBe(
      false,
    );
  });
  it("rejects moving a placed folder's thread ahead of the saved folder order", () => {
    expect(keepsSidebarWorkspaceArrangement(["g1", "s1", "s2"], ["s", "g"], keyOf)).toBe(false);
  });
  it("lets an unplaced thread move among the unplaced ones, but not into a placed folder", () => {
    expect(keepsSidebarWorkspaceArrangement(["y", "x", "s1", "s2"], ["s"], keyOf)).toBe(true);
    expect(keepsSidebarWorkspaceArrangement(["y", "s1", "x", "s2"], ["s"], keyOf)).toBe(false);
  });
});

describe("moveSidebarWorkspace", () => {
  it("writes the visible order and keeps hidden saved keys after it", () => {
    expect(moveSidebarWorkspace(["hidden", "a"], ["a", "b", "c"], "c", "a")).toEqual([
      "c",
      "a",
      "b",
      "hidden",
    ]);
  });
  it("returns the saved order unchanged for a drop in place or an unknown key", () => {
    expect(moveSidebarWorkspace(["a"], ["a", "b"], "a", "a")).toEqual(["a"]);
    expect(moveSidebarWorkspace(["a"], ["a", "b"], "x", "a")).toEqual(["a"]);
  });
});
