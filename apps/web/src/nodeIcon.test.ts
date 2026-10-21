import { describe, expect, it } from "vite-plus/test";
import { resolveNodeIcon } from "./nodeIcon";

describe("resolveNodeIcon", () => {
  const nodeIcons = { "build-box": "server", "Den.local": "house" } as const;

  it("uses the icon configured for the environment's label", () => {
    expect(resolveNodeIcon({ label: "Build Box", machine: "laptop", nodeIcons })).toEqual({
      name: "server",
      className: "text-orange-600 dark:text-orange-400",
    });
    expect(resolveNodeIcon({ label: "den", machine: null, nodeIcons })).toEqual({
      name: "house",
      className: "text-green-600 dark:text-green-400",
    });
  });
  it("falls back to recognized machine kinds", () => {
    expect(resolveNodeIcon({ label: "Office", machine: "mac-mini", nodeIcons })?.name).toBe(
      "monitor",
    );
    expect(resolveNodeIcon({ label: "Travel", machine: "laptop", nodeIcons })?.name).toBe("laptop");
  });
  it("preserves project icons on unknown nodes", () => {
    expect(resolveNodeIcon({ label: "Other", machine: "server", nodeIcons })).toBeNull();
    expect(resolveNodeIcon({ label: "Mac mini", machine: null, nodeIcons: {} })).toBeNull();
  });
});
