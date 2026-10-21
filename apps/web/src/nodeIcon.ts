import type { EnvironmentMachineKind, NodeIconKind } from "@t3tools/contracts";
import { HouseIcon, LaptopIcon, MonitorIcon, ServerIcon } from "lucide-react";

export const NODE_ICON_COMPONENT = {
  server: ServerIcon,
  house: HouseIcon,
  monitor: MonitorIcon,
  laptop: LaptopIcon,
} satisfies Record<NodeIconKind, unknown>;

export const NODE_ICON_CLASS: Record<NodeIconKind, string> = {
  server: "text-orange-600 dark:text-orange-400",
  house: "text-green-600 dark:text-green-400",
  monitor: "text-blue-600 dark:text-blue-400",
  laptop: "text-gray-800 dark:text-gray-200",
};

// "Studio-Mac.local", "studiomac" and "Studio Mac" name the same machine.
export const normalizeNodeLabel = (label: string) =>
  label
    .replace(/\.local$/i, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");

export function resolveNodeIcon(input: {
  label: string;
  machine: EnvironmentMachineKind | null;
  nodeIcons: Readonly<Record<string, NodeIconKind>>;
}) {
  const label = normalizeNodeLabel(input.label);
  const configured = Object.entries(input.nodeIcons).find(
    ([key]) => normalizeNodeLabel(key) === label,
  )?.[1];
  const name =
    configured ??
    (input.machine === "mac-mini" ? "monitor" : input.machine === "laptop" ? "laptop" : null);
  return name === null ? null : { name, className: NODE_ICON_CLASS[name] };
}
