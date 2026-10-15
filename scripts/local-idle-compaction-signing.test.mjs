import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { identityArguments } from "./local-idle-compaction-signing.mjs";

NodeTest.test("persistent signing uses the exact identity and dedicated keychain", () => {
  NodeAssert.deepEqual(
    identityArguments({ identity: "A".repeat(40), keychain: "/private/signing.keychain-db" }),
    ["--sign", "A".repeat(40), "--keychain", "/private/signing.keychain-db", "--timestamp=none"],
  );
});

NodeTest.test("missing or ad-hoc identities cannot silently replace persistent signing", () => {
  for (const identity of [
    null,
    {},
    { identity: "-", keychain: "/signing" },
    { identity: "A".repeat(40), keychain: "relative.keychain-db" },
  ])
    NodeAssert.throws(() => identityArguments(identity), /persistent Desktop signing identity/);
});
