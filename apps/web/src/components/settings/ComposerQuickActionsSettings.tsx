import { randomUUID } from "../../lib/utils";
import { lazy, Suspense, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  DEFAULT_COMPOSER_QUICK_ACTIONS,
  type ComposerQuickAction,
} from "@t3tools/contracts/settings";
import * as Equal from "effect/Equal";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { ComposerQuickActionIcon } from "../chat/ComposerQuickActionIcon";

import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { moveComposerQuickAction } from "./ComposerQuickActionsSettings.logic";

const ProjectIconPickerDialog = lazy(() =>
  import("./ProjectIconPickerDialog").then((module) => ({
    default: module.ProjectIconPickerDialog,
  })),
);

export function ComposerQuickActionsSettings() {
  const actions = useScopedSettings().composerQuickActions;
  const updateSettings = useUpdateScopedSettings();
  const [iconActionId, setIconActionId] = useState<string | null>(null);
  const iconAction = actions.find((action) => action.id === iconActionId);
  const save = (composerQuickActions: readonly ComposerQuickAction[]) =>
    updateSettings({ composerQuickActions });
  const change = (
    id: string,
    patch: Partial<Pick<ComposerQuickAction, "label" | "text" | "icon" | "enabled">>,
  ) => save(actions.map((action) => (action.id === id ? { ...action, ...patch } : action)));

  return (
    <SettingsRow
      {...searchableSetting("composer-quick-actions")}
      description="Customize the buttons next to the model and permissions controls. Changes save automatically for this client. Buttons insert text into the draft without sending it."
      resetAction={
        !Equal.equals(actions, DEFAULT_COMPOSER_QUICK_ACTIONS) ? (
          <SettingResetButton
            label="quick action shortcuts"
            onClick={() => save(DEFAULT_COMPOSER_QUICK_ACTIONS)}
          />
        ) : null
      }
    >
      <div className="space-y-3">
        {actions.map((action, index) => (
          <div key={action.id} className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setIconActionId(action.id)}>
                <ComposerQuickActionIcon icon={action.icon} />
                Choose icon
              </Button>
              <div className="ml-auto flex items-center gap-1">
                <Switch
                  aria-label={`Show ${action.label || "shortcut"}`}
                  checked={action.enabled}
                  onCheckedChange={(enabled) => change(action.id, { enabled: Boolean(enabled) })}
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${action.label || "shortcut"} up`}
                  disabled={index === 0}
                  onClick={() => save(moveComposerQuickAction(actions, action.id, -1))}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${action.label || "shortcut"} down`}
                  disabled={index === actions.length - 1}
                  onClick={() => save(moveComposerQuickAction(actions, action.id, 1))}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  variant="ghost-destructive"
                  size="icon-xs"
                  aria-label={`Delete ${action.label || "shortcut"}`}
                  onClick={() => save(actions.filter((item) => item.id !== action.id))}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${action.id}-label`} className="text-sm font-medium">
                Button label
              </label>
              <Input
                id={`${action.id}-label`}
                value={action.label}
                maxLength={80}
                placeholder="Leave blank for an icon-only button"
                onChange={(event) => change(action.id, { label: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${action.id}-text`} className="text-sm font-medium">
                Text to insert
              </label>
              <Textarea
                id={`${action.id}-text`}
                value={action.text}
                maxLength={32000}
                rows={4}
                onChange={(event) => change(action.id, { text: event.target.value })}
              />
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            save([
              ...actions,
              {
                id: randomUUID(),
                label: "New shortcut",
                text: "",
                enabled: true,
                icon: { kind: "emoji", emoji: "✨" },
              },
            ])
          }
        >
          <PlusIcon />
          Add shortcut
        </Button>
      </div>
      {iconAction ? (
        <Suspense fallback={null}>
          <ProjectIconPickerDialog
            current={iconAction.icon}
            projectName={iconAction.label || "Shortcut"}
            title="Choose shortcut icon"
            open
            onOpenChange={(open) => {
              if (!open) setIconActionId(null);
            }}
            onSelect={(icon) => change(iconAction.id, { icon })}
          />
        </Suspense>
      ) : null}
    </SettingsRow>
  );
}
