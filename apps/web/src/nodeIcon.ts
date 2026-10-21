import type { EnvironmentMachineKind, NodeIconKind } from "@t3tools/contracts";

const NODE_ICON_CLASS: Record<NodeIconKind, string> = {
  server: "text-orange-600 dark:text-orange-400",
  house: "text-green-600 dark:text-green-400",
  monitor: "text-blue-600 dark:text-blue-400",
  laptop: "text-gray-800 dark:text-gray-200",
};

// "Studio-Mac.local", "studiomac" and "Studio Mac" name the same machine.
const normalizeLabel = (label: string) =>
  label
    .replace(/\.local$/i, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");

export function resolveNodeIcon(input: {
  label: string;
  machine: EnvironmentMachineKind | null;
  nodeIcons: Readonly<Record<string, NodeIconKind>>;
}) {
  const label = normalizeLabel(input.label);
  const configured = Object.entries(input.nodeIcons).find(
    ([key]) => normalizeLabel(key) === label,
  )?.[1];
  const name =
    configured ??
    (input.machine === "mac-mini" ? "monitor" : input.machine === "laptop" ? "laptop" : null);
  return name === null ? null : { name, className: NODE_ICON_CLASS[name] };
}
