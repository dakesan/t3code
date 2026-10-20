import { BookOpenIcon, ThumbsUpIcon, UsersRoundIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ComposerQuickActions(props: {
  canInsert: boolean;
  onInsert: (text: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Quick actions"
      className="mb-2 flex flex-wrap items-center gap-1.5"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="xs"
              disabled={!props.canInsert}
              onClick={() =>
                props.onInsert(
                  "Convene a council to evaluate the current proposal from multiple model perspectives. Propose the task, provider, model, and reasoning effort for each delegate, and obtain my approval before starting them.",
                )
              }
            />
          }
        >
          <UsersRoundIcon />
          Council
        </TooltipTrigger>
        <TooltipPopup>Insert a council request into the draft</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="xs"
              disabled={!props.canInsert}
              onClick={() => props.onInsert("LGTM")}
            />
          }
        >
          <ThumbsUpIcon />
          LGTM
        </TooltipTrigger>
        <TooltipPopup>Insert LGTM into the draft</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="xs"
              disabled={!props.canInsert}
              onClick={() =>
                props.onInsert(
                  "Explain the latest response or changes, including their purpose, behavior, and reasoning.",
                )
              }
            />
          }
        >
          <BookOpenIcon />
          Explain
        </TooltipTrigger>
        <TooltipPopup>Insert an explanation request into the draft</TooltipPopup>
      </Tooltip>
    </div>
  );
}
