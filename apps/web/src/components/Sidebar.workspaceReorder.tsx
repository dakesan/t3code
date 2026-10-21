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
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";
import { cn } from "~/lib/utils";
import { ProjectFavicon, type ProjectFaviconProject } from "./ProjectFavicon";
import { MiddleTruncate } from "./ui/middle-truncate";

export type SidebarWorkspaceReorderItem = {
  readonly key: string;
  readonly path: string;
  readonly environmentLabel: string | null;
  readonly threadCount: number;
  readonly project: ProjectFaviconProject | null;
};

/** A long press that is still held when the reorder list mounts. */
export type SidebarWorkspaceDragHandoff = {
  readonly key: string;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
};

/** How long a workspace header must be held before the sidebar folds into reorder mode. */
export const SIDEBAR_WORKSPACE_LONG_PRESS_MS = 450;
/** Duration of the fold that collapses thread rows before the reorder list appears. */
export const SIDEBAR_WORKSPACE_FOLD_MS = 220;
/** Pointer drift allowed while holding before the press counts as a scroll or drag instead. */
export const SIDEBAR_WORKSPACE_PRESS_SLOP_PX = 12;
/** Session icons drawn in a folder's stack before the rest collapse into "+N". */
const SESSION_STACK_LIMIT = 5;

export function sidebarWorkspaceLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
}

/**
 * Collapse every thread row under the list so only workspace headers remain,
 * then resolve. Runs on the existing rows, so the user sees their tasks fold
 * away rather than the list being swapped out. Resolves on a timer, not on the
 * animations: Chromium pauses animations in an occluded window, and the list
 * must still open.
 */
export function foldSidebarThreadRows(list: HTMLElement | null): Promise<void> {
  if (list !== null && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const timing: KeyframeAnimationOptions = {
      duration: SIDEBAR_WORKSPACE_FOLD_MS,
      easing: "ease-in",
      fill: "forwards",
    };
    for (const child of list.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.dataset.workspaceHeader !== undefined) {
        child.animate(
          [
            { transform: "scale(1)", opacity: 0.8 },
            { transform: "scale(1.04)", opacity: 1 },
          ],
          timing,
        );
        continue;
      }
      const height = child.getBoundingClientRect().height;
      child.style.overflow = "hidden";
      child.animate(
        [
          { height: `${height}px`, opacity: 1 },
          { height: "0px", opacity: 0 },
        ],
        timing,
      );
    }
  }
  return new Promise((resolve) => window.setTimeout(resolve, SIDEBAR_WORKSPACE_FOLD_MS));
}

function SessionStack(props: { project: ProjectFaviconProject | null; count: number }) {
  const shown = Math.min(props.count, SESSION_STACK_LIMIT);
  return (
    <span
      className="flex shrink-0 items-center"
      aria-label={`${props.count} ${props.count === 1 ? "session" : "sessions"}`}
    >
      {Array.from({ length: shown }, (_, index) => (
        <span
          key={index}
          aria-hidden
          // Each icon tucks under the previous one, so the stack's length reads as the count.
          className="-ml-1.5 flex size-5 items-center justify-center rounded-full bg-sidebar ring-2 ring-sidebar first:ml-0"
          style={{ zIndex: shown - index }}
        >
          {props.project ? (
            <ProjectFavicon project={props.project} className="size-3.5" />
          ) : (
            <span className="size-2 rounded-full bg-sidebar-muted-foreground" />
          )}
        </span>
      ))}
      {props.count > shown ? (
        <span className="ml-1 text-2xs tabular-nums text-secondary-label">
          +{props.count - shown}
        </span>
      ) : null}
    </span>
  );
}

function SortableWorkspace(props: { item: SidebarWorkspaceReorderItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.key,
  });
  return (
    <li
      ref={setNodeRef}
      data-workspace-key={props.item.key}
      {...attributes}
      {...listeners}
      className={cn(
        "flex h-11 cursor-grab touch-none list-none items-center gap-2 rounded-md px-2.5 text-sidebar-foreground outline-none select-none",
        "hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        // The lifted folder covers the one beneath it, so it needs an opaque surface.
        isDragging &&
          "relative z-10 cursor-grabbing bg-sidebar shadow-lg ring-1 ring-sidebar-border",
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
      <SessionStack project={props.item.project} count={props.item.threadCount} />
    </li>
  );
}

export function SidebarWorkspaceReorderList(props: {
  items: readonly SidebarWorkspaceReorderItem[];
  onMove: (activeKey: string, overKey: string) => void;
  onDone: () => void;
  takeDragHandoff: () => SidebarWorkspaceDragHandoff | null;
}) {
  const { onDone } = props;
  const listRef = useRef<HTMLUListElement | null>(null);
  const takeDragHandoff = useEffectEvent(() => props.takeDragHandoff());
  // When the long press is still held, start the drag on the folder that was
  // pressed, so holding and dragging is one gesture. The real pointer keeps
  // sending moves, so dnd-kit only needs the press it missed.
  useLayoutEffect(() => {
    const handoff = takeDragHandoff();
    if (handoff === null) return;
    const target = [...(listRef.current?.children ?? [])].find(
      (child) => child instanceof HTMLElement && child.dataset.workspaceKey === handoff.key,
    );
    target?.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: handoff.x,
        clientY: handoff.y,
        button: 0,
        buttons: 1,
        pointerId: handoff.pointerId,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
  }, []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 2 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Releasing the held press applies the order and returns to the threads.
  // dnd-kit handles the release on document first, so a drop is saved before
  // this listener on window closes the list.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDone();
    };
    const handlePointerUp = () => onDone();
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [onDone]);
  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over && event.active.id !== event.over.id) {
      props.onMove(String(event.active.id), String(event.over.id));
    }
  };
  return (
    <div className="flex min-h-0 flex-col gap-1 px-2 pt-1" data-testid="sidebar-workspace-reorder">
      <div className="px-1 pb-1 text-xs text-secondary-label">Drag, then release to apply</div>
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
          <ul ref={listRef} role="list" className="flex flex-col gap-0.5">
            {props.items.map((item) => (
              <SortableWorkspace key={item.key} item={item} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}
