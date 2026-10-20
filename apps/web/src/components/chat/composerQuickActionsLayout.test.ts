import { describe, expect, it } from "vite-plus/test";
import { resolveQuickActionsLayout } from "./composerQuickActionsLayout";

describe("quick action layout", () => {
  it("shows labels only when the complete row fits", () => {
    expect(
      resolveQuickActionsLayout({ availableWidth: 240, labeledWidth: 240, iconsWidth: 84 }),
    ).toBe("labels");
    expect(
      resolveQuickActionsLayout({ availableWidth: 239, labeledWidth: 240, iconsWidth: 84 }),
    ).toBe("icons");
  });
  it("moves every shortcut to the menu when even the icons do not fit", () => {
    expect(
      resolveQuickActionsLayout({ availableWidth: 84, labeledWidth: 240, iconsWidth: 84 }),
    ).toBe("icons");
    expect(
      resolveQuickActionsLayout({ availableWidth: 83, labeledWidth: 240, iconsWidth: 84 }),
    ).toBe("menu");
  });
  it("uses measured content widths for long labels and many custom shortcuts", () => {
    expect(
      resolveQuickActionsLayout({ availableWidth: 500, labeledWidth: 2400, iconsWidth: 700 }),
    ).toBe("menu");
    expect(
      resolveQuickActionsLayout({ availableWidth: 0, labeledWidth: 240, iconsWidth: 84 }),
    ).toBe("menu");
  });
});
