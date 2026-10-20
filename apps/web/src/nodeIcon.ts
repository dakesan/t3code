import type { EnvironmentMachineKind } from "@t3tools/contracts";

export function resolveNodeIcon(input: { label: string; machine: EnvironmentMachineKind | null }) {
  const label = input.label
    .replace(/\.local$/i, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");
  if (label.includes("coordinator") || label === "coordinatorhost") {
    return { name: "server", className: "text-orange-600 dark:text-orange-400" } as const;
  }
  if (["homebox", "home", "homeserver"].includes(label)) {
    return { name: "house", className: "text-green-600 dark:text-green-400" } as const;
  }
  if (label.includes("macmini") || input.machine === "mac-mini") {
    return { name: "monitor", className: "text-blue-600 dark:text-blue-400" } as const;
  }
  if (label.includes("macbook") || label === "travelmac" || input.machine === "laptop") {
    return { name: "laptop", className: "text-gray-800 dark:text-gray-200" } as const;
  }
  return null;
}
