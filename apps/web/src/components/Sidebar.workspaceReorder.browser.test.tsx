import { describe, expect, it, vi } from "vite-plus/test";
import { act, render } from "../../test/render";
import {
  SidebarWorkspaceReorderList,
  type SidebarWorkspaceReorderItem,
} from "./Sidebar.workspaceReorder";

const items: SidebarWorkspaceReorderItem[] = ["a", "b", "c"].map((key) => ({
  key,
  label: key,
  environmentLabel: null,
  sessions: [],
}));

function pointer(type: string, clientY: number, buttons = 1) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    clientX: 40,
    clientY,
    buttons,
    isPrimary: true,
  });
}

describe("SidebarWorkspaceReorderList", () => {
  it("keeps a folder carried over from a held press under the pointer", async () => {
    const onMove = vi.fn();
    await using screen = await render(
      <SidebarWorkspaceReorderList
        items={items}
        onMove={onMove}
        onDone={() => {}}
        takeDragHandoff={() => ({ key: "c", pointerId: 1 })}
      />,
    );
    const centerOf = (key: string) => {
      const rect = screen.container
        .querySelector(`[data-workspace-key="${key}"]`)!
        .getBoundingClientRect();
      return rect.top + rect.height / 2;
    };
    // The pressed header sat well below where its folder lands in the compact list.
    const heldY = centerOf("c") + 300;
    await act(() => document.dispatchEvent(pointer("pointermove", heldY)));
    await act(() => document.dispatchEvent(pointer("pointermove", heldY - 1)));
    expect(centerOf("c")).toBeCloseTo(heldY - 1, 0);

    const topY = centerOf("a");
    await act(() => document.dispatchEvent(pointer("pointermove", topY)));
    expect(centerOf("c")).toBeCloseTo(topY, 0);
    await act(() => document.dispatchEvent(pointer("pointerup", topY, 0)));
    expect(onMove).toHaveBeenCalledExactlyOnceWith("c", "a");
  });
});
