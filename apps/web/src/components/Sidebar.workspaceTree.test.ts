import { describe, expect, it } from "vite-plus/test";
import { groupSidebarWorkspaces } from "./Sidebar.workspaceTree";

type FixtureThread = {
  id: string;
  environmentId: string;
  projectId: string;
  worktreePath: string | null;
  root: string | null;
};
const thread = (id: string, overrides: Partial<FixtureThread> = {}): FixtureThread => ({
  id,
  environmentId: "macbook",
  projectId: "project",
  worktreePath: "/repo/worktree",
  root: "/repo",
  ...overrides,
});
const group = (threads: ReturnType<typeof thread>[]) =>
  groupSidebarWorkspaces(threads, (item) => item.root).map((items) => items.map((item) => item.id));

describe("groupSidebarWorkspaces", () => {
  it("collects matching paths at their first appearance and preserves child order", () => {
    expect(group([thread("a"), thread("b", { worktreePath: "/other" }), thread("c")])).toEqual([
      ["a", "c"],
      ["b"],
    ]);
  });
  it("keeps environments, projects and distinct paths separate", () => {
    expect(
      group([
        thread("a"),
        thread("b", { environmentId: "macmini" }),
        thread("c", { projectId: "other" }),
        thread("d", { worktreePath: "/different" }),
      ]),
    ).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });
  it("uses the project root for local checkouts, including explicit root paths", () => {
    expect(
      group([thread("a", { worktreePath: null }), thread("b", { worktreePath: "/repo" })]),
    ).toEqual([["a", "b"]]);
  });
  it("does not combine unknown paths", () => {
    expect(
      group([
        thread("a", { worktreePath: null, root: null }),
        thread("b", { worktreePath: null, root: null }),
      ]),
    ).toEqual([["a"], ["b"]]);
  });
  it("handles empty lists and singleton workspaces", () => {
    expect(group([])).toEqual([]);
    expect(group([thread("a")])).toEqual([["a"]]);
  });
  it("does not mutate the input", () => {
    const input = [thread("a"), thread("b", { worktreePath: "/other" }), thread("c")];
    const before = structuredClone(input);
    group(input);
    expect(input).toEqual(before);
  });
});
