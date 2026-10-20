import { assert, describe, it } from "@effect/vitest";

import { remoteArchiveVersion } from "./remoteArchiveVersion.ts";

describe("remoteArchiveVersion", () => {
  it("maps a local build to the upstream release it is based on", () => {
    assert.strictEqual(
      remoteArchiveVersion("0.1.1-nightly.20261018.3335-local.3b27e842d0"),
      "0.1.1-nightly.20261018.3335",
    );
  });

  it("keeps upstream versions unchanged", () => {
    assert.strictEqual(
      remoteArchiveVersion("0.1.1-nightly.20261018.3335"),
      "0.1.1-nightly.20261018.3335",
    );
    assert.strictEqual(remoteArchiveVersion("0.0.45"), "0.0.45");
  });

  it("only strips a trailing local suffix", () => {
    assert.strictEqual(remoteArchiveVersion("1.2.3-local.abc.rc1"), "1.2.3-local.abc.rc1");
  });
});
