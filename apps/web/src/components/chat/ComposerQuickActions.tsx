import type { ComposerQuickAction } from "@t3tools/contracts/settings";
import { EllipsisIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { observeResize } from "~/lib/observeResize";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerQuickActionIcon } from "./ComposerQuickActionIcon";
import { resolveQuickActionsLayout } from "./composerQuickActionsLayout";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

export function ComposerQuickActions(props: {
  actions: readonly ComposerQuickAction[];
  canInsert: boolean;
  onInsert: (text: string) => void;
}) {
  const actions = props.actions.filter((action) => action.enabled);
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const iconsRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<"labels" | "icons" | "menu">("menu");
  const floatingLayerProps = useComposerMenuProps();
  const [menuOpen, setMenuOpen] = useComposerMenuState(layout !== "menu");

  useLayoutEffect(() => {
    if (!props.actions.some((action) => action.enabled)) return;
    const host = hostRef.current;
    const labels = labelsRef.current;
    const icons = iconsRef.current;
    if (!host || !labels || !icons) return;
    const measure = () => {
      setLayout(
        resolveQuickActionsLayout({
          availableWidth: host.clientWidth,
          labeledWidth: labels.getBoundingClientRect().width,
          iconsWidth: icons.getBoundingClientRect().width,
        }),
      );
    };
    measure();
    return observeResize([host, labels, icons], measure);
  }, [props.actions]);

  if (actions.length === 0) return null;
  return (
    <div
      ref={hostRef}
      role="group"
      aria-label="Quick actions"
      data-quick-actions-layout={layout}
      className="relative min-w-7 flex-1"
    >
      {/* Measure both rows independently so changing the visible mode cannot affect its fit test. */}
      <div
        aria-hidden="true"
        inert
        className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden"
      >
        <div ref={labelsRef} className="flex w-max items-center gap-1.5">
          {actions.map((action) => (
            <Button key={action.id} variant="outline" size="xs" tabIndex={-1}>
              <ComposerQuickActionIcon icon={action.icon} />
              {action.label}
            </Button>
          ))}
        </div>
        <div ref={iconsRef} className="flex w-max items-center gap-1.5">
          {actions.map((action) => (
            <Button key={action.id} variant="outline" size="icon-xs" tabIndex={-1}>
              <ComposerQuickActionIcon icon={action.icon} />
            </Button>
          ))}
        </div>
      </div>
      {layout === "menu" ? (
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <MenuTrigger
            render={<Button variant="outline" size="icon-xs" aria-label="Quick action shortcuts" />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="start" {...floatingLayerProps}>
            {actions.map((action) => (
              <MenuItem
                key={action.id}
                disabled={!props.canInsert || action.text.trim().length === 0}
                onClick={() => props.onInsert(action.text)}
              >
                <ComposerQuickActionIcon icon={action.icon} />
                <span className="min-w-0 break-words">
                  {action.label.trim() || "Insert shortcut"}
                </span>
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      ) : (
        <div className="flex w-max items-center gap-1.5">
          {actions.map((action) => (
            <Tooltip key={action.id}>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size={layout === "labels" ? "xs" : "icon-xs"}
                    aria-label={action.label.trim() || "Insert shortcut"}
                    disabled={!props.canInsert || action.text.trim().length === 0}
                    onClick={() => props.onInsert(action.text)}
                  />
                }
              >
                <ComposerQuickActionIcon icon={action.icon} />
                {layout === "labels" ? action.label : null}
              </TooltipTrigger>
              <TooltipPopup>
                <div>{action.label.trim() || "Insert shortcut"}</div>
                <div>
                  {action.text.trim() || "Add text in Settings → General → Quick action shortcuts"}
                </div>
              </TooltipPopup>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
