import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  ClientSettingsPatch,
  ClientSettingsSchema,
  DEFAULT_COMPOSER_QUICK_ACTIONS,
} from "./settings.ts";

const decode = Schema.decodeUnknownSync(ClientSettingsSchema);
const encode = Schema.encodeSync(ClientSettingsSchema);
const patch = Schema.decodeUnknownSync(ClientSettingsPatch);

describe("composer quick action settings", () => {
  it("keeps the existing three shortcuts when opening old settings", () => {
    expect(decode({}).composerQuickActions).toEqual(DEFAULT_COMPOSER_QUICK_ACTIONS);
    expect(patch({})).not.toHaveProperty("composerQuickActions");
  });
  it("round trips custom emoji, blank labels, text, visibility and order", () => {
    const composerQuickActions = [
      {
        id: "custom",
        label: "",
        icon: { kind: "emoji", emoji: "🧬" },
        text: "Review the experiment\nCheck controls",
        enabled: true,
      },
      { ...DEFAULT_COMPOSER_QUICK_ACTIONS[0], enabled: false },
    ];
    expect(patch({ composerQuickActions })).toEqual({ composerQuickActions });
    expect(encode(decode({ composerQuickActions })).composerQuickActions).toEqual(
      composerQuickActions,
    );
  });
  it("preserves removing every shortcut", () => {
    expect(encode(decode({ composerQuickActions: [] })).composerQuickActions).toEqual([]);
  });
  it("rejects malformed icon data rather than persisting an unusable shortcut", () => {
    expect(() =>
      patch({
        composerQuickActions: [{ ...DEFAULT_COMPOSER_QUICK_ACTIONS[0], icon: { kind: "other" } }],
      }),
    ).toThrow();
  });
});
