import type { ComposerQuickAction } from "@t3tools/contracts/settings";

export function moveComposerQuickAction(
  actions: readonly ComposerQuickAction[],
  id: string,
  direction: -1 | 1,
): readonly ComposerQuickAction[] {
  const index = actions.findIndex((action) => action.id === id);
  const destination = index + direction;
  const action = actions[index];
  if (!action || destination < 0 || destination >= actions.length) return actions;
  const result = actions.filter((item) => item.id !== id);
  result.splice(destination, 0, action);
  return result;
}
