import type { ComposerQuickAction } from "@t3tools/contracts/settings";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerQuickActionIcon } from "./ComposerQuickActionIcon";

export function ComposerQuickActions(props: {
  actions: readonly ComposerQuickAction[];
  canInsert: boolean;
  onInsert: (text: string) => void;
}) {
  const actions = props.actions.filter((action) => action.enabled);
  if (actions.length === 0) return null;
  return (
    <div role="group" aria-label="Quick actions" className="flex shrink-0 items-center gap-1.5">
      {actions.map((action) => (
        <Tooltip key={action.id}>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="xs"
                aria-label={action.label.trim() || "Insert shortcut"}
                disabled={!props.canInsert || action.text.trim().length === 0}
                onClick={() => props.onInsert(action.text)}
              />
            }
          >
            <ComposerQuickActionIcon icon={action.icon} />
            {action.label}
          </TooltipTrigger>
          <TooltipPopup>
            {action.text.trim() || "Add text in Settings → General → Quick action shortcuts"}
          </TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
