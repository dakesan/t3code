import { describe, expect, it } from "vite-plus/test";

import {
  isLocalDesktopVersion,
  isNightlyDesktopVersion,
  resolveDefaultDesktopUpdateChannel,
} from "./updateChannels.ts";

describe("updateChannels", () => {
  it("keeps preview builds branded as nightly but on the latest update channel", () => {
    expect(isNightlyDesktopVersion("0.0.41-preview.20260911.7")).toBe(true);
    expect(resolveDefaultDesktopUpdateChannel("0.0.41-preview.20260911.7")).toBe("latest");
    expect(resolveDefaultDesktopUpdateChannel("0.0.41-nightly.20260911.7")).toBe("nightly");
  });

  it("recognizes locally built fork versions", () => {
    expect(isLocalDesktopVersion("0.1.1-local.2352a925")).toBe(true);
    expect(isLocalDesktopVersion("0.1.1-nightly.20261018.3335")).toBe(false);
    expect(isLocalDesktopVersion("1.2.3-foo-local.1")).toBe(false);
  });

  it("only matches the first prerelease identifier", () => {
    expect(isNightlyDesktopVersion("1.2.3-foo-preview.20260911.1")).toBe(false);
    expect(isNightlyDesktopVersion("1.2.3")).toBe(false);
  });
});
