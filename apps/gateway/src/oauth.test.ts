import assert from "node:assert/strict";
import test from "node:test";
import { pkceMatches, pkceS256 } from "./oauth.js";

test("PKCE S256 accepts the matching verifier and rejects another", () => {
  const verifier = "a".repeat(50);
  const challenge = pkceS256(verifier);
  assert.equal(pkceMatches(verifier, challenge), true);
  assert.equal(pkceMatches(`${verifier}x`, challenge), false);
});
