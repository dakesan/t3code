export function resolveQuickActionsLayout(input: {
  availableWidth: number;
  labeledWidth: number;
  iconsWidth: number;
}): "labels" | "icons" | "menu" {
  if (input.labeledWidth <= input.availableWidth) return "labels";
  if (input.iconsWidth <= input.availableWidth) return "icons";
  return "menu";
}
