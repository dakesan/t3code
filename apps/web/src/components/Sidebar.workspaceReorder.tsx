import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { useEffect } from "react";
import { cn } from "~/lib/utils";
import { MiddleTruncate } from "./ui/middle-truncate";

export type SidebarWorkspaceReorderItem = {
  readonly key: string;
  readonly path: string;
  readonly environmentLabel: string | null;
  readonly threadCount: number;
};

/** How long a workspace header must be held before the sidebar folds into reorder mode. */
export const SIDEBAR_WORKSPACE_LONG_PRESS_MS = 450;
/** Duration of the fold that collapses thread rows before the reorder list appears. */
export const SIDEBAR_WORKSPACE_FOLD_MS = 220;

export function sidebarWorkspaceLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
}

/**
 * Collapse every thread row under the list so only workspace headers remain,
 * then resolve. Runs on the existing rows, so the user sees their tasks fold
 * away rather than the list being swapped out.
 */
export function foldSidebarThreadRows(list: HTMLElement | null): Promise<void> {
  if (list === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return Promise.resolve();
  }
  const animations: Animation[] = [];
  for (const child of list.children) {
    if (!(child instanceof HTMLElement)) continue;
    const timing = { duration: SIDEBAR_WORKSPACE_FOLD_MS, easing: "ease-in", fill: "forwards" };
    if (child.dataset.workspaceHeader !== undefined) {
      animations.push(
        child.animate(
          [
            { transform: "scale(1)", opacity: 0.8 },
            { transform: "scale(1.04)", opacity: 1 },
          ],
          timing as KeyframeAnimationOptions,
        ),
      );
      continue;
    }
    const height = child.getBoundingClientRect().height;
    child.style.overflow = "hidden";
    animations.push(
      child.animate(
        [
          { height: `${height}px`, opacity: 1 },
          { height: "0px", opacity: 0 },
        ],
        timing as KeyframeAnimationOptions,
      ),
    );
  }
  return Promise.all(animations.map((animation) => animation.finished)).then(() => undefined);
}

function SortableWorkspace(props: { item: SidebarWorkspaceReorderItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.key,
  });
  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "flex h-11 cursor-grab touch-none list-none items-center gap-2 rounded-md px-2.5 text-sidebar-foreground outline-none select-none",
        "hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        isDragging && "relative z-10 cursor-grabbing bg-sidebar-row-active shadow-md",
      )}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <GripVerticalIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          <MiddleTruncate value={sidebarWorkspaceLabel(props.item.path)} showTitle={false} />
        </span>
        {props.item.environmentLabel ? (
          <span className="block truncate text-2xs text-secondary-label">
            {props.item.environmentLabel}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-secondary-label">
        {props.item.threadCount}
      </span>
    </li>
  );
}

export function SidebarWorkspaceReorderList(props: {
  items: readonly SidebarWorkspaceReorderItem[];
  onMove: (activeKey: string, overKey: string) => void;
  onDone: () => void;
}) {
  const { onDone } = props;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 2 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDone]);
  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over && event.active.id !== event.over.id) {
      props.onMove(String(event.active.id), String(event.over.id));
    }
  };
  return (
    <div className="flex min-h-0 flex-col gap-1 px-2 pt-1" data-testid="sidebar-workspace-reorder">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-xs text-secondary-label">Drag to reorder folders</span>
        <button
          type="button"
          className="rounded-md px-2 py-0.5 text-xs font-medium text-sidebar-foreground hover:bg-sidebar-row-hover"
          onClick={onDone}
        >
          Done
        </button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={props.items.map((item) => item.key)}
          strategy={verticalListSortingStrategy}
        >
          <ul role="list" className="flex flex-col gap-0.5">
            {props.items.map((item) => (
              <SortableWorkspace key={item.key} item={item} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}
