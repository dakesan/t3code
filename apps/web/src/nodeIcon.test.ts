import { describe, expect, it } from "vite-plus/test";
import { resolveNodeIcon } from "./nodeIcon";

describe("resolveNodeIcon", () => {
  it.each(["Mac mini", "macmini", "Studio-Mac-mini"])("uses blue for %s", (label) => {
    expect(resolveNodeIcon({ label, machine: null })).toEqual({
      name: "monitor",
      className: "text-blue-600 dark:text-blue-400",
    });
  });
  it.each(["MacBook", "macbook-work", "TravelMac.local"])("uses monochrome for %s", (label) => {
    expect(resolveNodeIcon({ label, machine: null })).toEqual({
      name: "laptop",
      className: "text-gray-800 dark:text-gray-200",
    });
  });
  it.each(["Coordinator", "coordinator-host"])("uses orange for %s", (label) => {
    expect(resolveNodeIcon({ label, machine: null })).toEqual({
      name: "server",
      className: "text-orange-600 dark:text-orange-400",
    });
  });
  it.each(["home", "homebox", "home-server"])("uses green for %s", (label) => {
    expect(resolveNodeIcon({ label, machine: null })).toEqual({
      name: "house",
      className: "text-green-600 dark:text-green-400",
    });
  });
  it("falls back to recognized machine kinds when a connection is renamed", () => {
    expect(resolveNodeIcon({ label: "Office", machine: "mac-mini" })?.name).toBe("monitor");
    expect(resolveNodeIcon({ label: "Travel", machine: "laptop" })?.name).toBe("laptop");
  });
  it("preserves project icons on unknown nodes", () => {
    expect(resolveNodeIcon({ label: "Other", machine: "server" })).toBeNull();
  });
});
