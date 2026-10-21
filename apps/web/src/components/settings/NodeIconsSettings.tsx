import { NodeIconKind, type EnvironmentId } from "@t3tools/contracts";
import { useEnvironment, useEnvironmentIdentities } from "../../state/environments";
import { NODE_ICON_CLASS, NODE_ICON_COMPONENT, normalizeNodeLabel } from "../../nodeIcon";
import { cn } from "~/lib/utils";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const AUTOMATIC = "automatic";
const NODE_ICON_LABELS: Record<NodeIconKind, string> = {
  server: "Server",
  house: "House",
  monitor: "Desktop",
  laptop: "Laptop",
};

function NodeIconChoice(props: { kind: NodeIconKind }) {
  const Icon = NODE_ICON_COMPONENT[props.kind];
  return (
    <span className="flex items-center gap-2">
      <Icon aria-hidden className={cn("size-4 shrink-0", NODE_ICON_CLASS[props.kind])} />
      {NODE_ICON_LABELS[props.kind]}
    </span>
  );
}

function NodeIconRow(props: {
  environmentId: EnvironmentId;
  fallbackLabel: string;
  nodeIcons: Readonly<Record<string, NodeIconKind>>;
  onChange: (label: string, kind: NodeIconKind | null) => void;
}) {
  const environment = useEnvironment(props.environmentId);
  // Same label the sidebar matches, so a choice here always reaches its rows.
  const label =
    environment?.serverConfig?.environment.label ?? environment?.label ?? props.fallbackLabel;
  const key = Object.keys(props.nodeIcons).find(
    (candidate) => normalizeNodeLabel(candidate) === normalizeNodeLabel(label),
  );
  const kind = key === undefined ? null : props.nodeIcons[key]!;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-sm">{label}</span>
      <Select
        value={kind ?? AUTOMATIC}
        onValueChange={(value) =>
          props.onChange(label, value === AUTOMATIC ? null : (value as NodeIconKind))
        }
      >
        <SelectTrigger size="sm" className="w-36 shrink-0" aria-label={`Icon for ${label}`}>
          <SelectValue>{kind === null ? "Automatic" : <NodeIconChoice kind={kind} />}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          <SelectItem hideIndicator value={AUTOMATIC}>
            Automatic
          </SelectItem>
          {NodeIconKind.literals.map((choice) => (
            <SelectItem hideIndicator key={choice} value={choice}>
              <NodeIconChoice kind={choice} />
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

export function NodeIconsSettings() {
  const nodeIcons = useScopedSettings().nodeIcons;
  const updateSettings = useUpdateScopedSettings();
  const environments = useEnvironmentIdentities();
  const change = (label: string, kind: NodeIconKind | null) => {
    const next = Object.fromEntries(
      Object.entries(nodeIcons).filter(
        ([key]) => normalizeNodeLabel(key) !== normalizeNodeLabel(label),
      ),
    );
    updateSettings({ nodeIcons: kind === null ? next : { ...next, [label]: kind } });
  };
  return (
    <SettingsRow
      {...searchableSetting("node-icons")}
      description="Mark each environment's projects in the sidebar with an icon. Automatic uses the computer type the environment reports. Saved for this client only."
      resetAction={
        Object.keys(nodeIcons).length > 0 ? (
          <SettingResetButton
            label="node icons"
            onClick={() => updateSettings({ nodeIcons: {} })}
          />
        ) : null
      }
    >
      <div className="space-y-2">
        {environments.map((environment) => (
          <NodeIconRow
            key={environment.environmentId}
            environmentId={environment.environmentId}
            fallbackLabel={environment.label}
            nodeIcons={nodeIcons}
            onChange={change}
          />
        ))}
      </div>
    </SettingsRow>
  );
}
