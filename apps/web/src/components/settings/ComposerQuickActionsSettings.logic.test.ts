import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_COMPOSER_QUICK_ACTIONS } from "@t3tools/contracts/settings";
import { moveComposerQuickAction } from "./ComposerQuickActionsSettings.logic";

describe("moveComposerQuickAction", () => {
  it("moves a shortcut while preserving all content and the input order", () => {
    const actions = DEFAULT_COMPOSER_QUICK_ACTIONS;
    const result = moveComposerQuickAction(actions, "explain", -1);
    expect(result.map((action) => action.id)).toEqual(["council", "explain", "lgtm"]);
    expect(result.find((action) => action.id === "explain")).toEqual(actions[2]);
    expect(actions.map((action) => action.id)).toEqual(["council", "lgtm", "explain"]);
    expect(moveComposerQuickAction(result, "explain", 1)).toEqual(actions);
  });
  it("keeps the list when moving beyond an end or using an unknown shortcut", () => {
    const actions = DEFAULT_COMPOSER_QUICK_ACTIONS;
    expect(moveComposerQuickAction(actions, "council", -1)).toBe(actions);
    expect(moveComposerQuickAction(actions, "explain", 1)).toBe(actions);
    expect(moveComposerQuickAction(actions, "missing", 1)).toBe(actions);
    expect(moveComposerQuickAction([], "missing", 1)).toEqual([]);
  });
});
