import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProjectIconOverride } from "./project.ts";

export const ComposerQuickAction = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: Schema.String.check(Schema.isMaxLength(80)),
  icon: ProjectIconOverride,
  text: Schema.String.check(Schema.isMaxLength(32000)),
  enabled: Schema.Boolean,
});
export type ComposerQuickAction = typeof ComposerQuickAction.Type;
export const ComposerQuickActions = Schema.Array(ComposerQuickAction);

export const DEFAULT_COMPOSER_QUICK_ACTIONS: readonly ComposerQuickAction[] = [
  {
    id: "council",
    label: "Council",
    icon: { kind: "lucide", name: "users-round", color: "gray" },
    enabled: true,
    text: "Convene a council to evaluate the current proposal from multiple model perspectives. Propose the task, provider, model, and reasoning effort for each delegate, and obtain my approval before starting them.",
  },
  {
    id: "lgtm",
    label: "LGTM",
    icon: { kind: "lucide", name: "thumbs-up", color: "gray" },
    enabled: true,
    text: "LGTM",
  },
  {
    id: "explain",
    label: "Explain",
    icon: { kind: "lucide", name: "book-open", color: "gray" },
    enabled: true,
    text: "Explain the latest response or changes, including their purpose, behavior, and reasoning.",
  },
];
