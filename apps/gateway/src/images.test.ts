import assert from "node:assert/strict";
import test from "node:test";
import { assertImageRef } from "./images.js";

test("hosted images need a tag and reject loose strings", () => {
  assert.doesNotThrow(() => assertImageRef("ghcr.io/org/server:1.0.0"));
  assert.doesNotThrow(() => assertImageRef("localhost:5000/mcp:1"));
  assert.throws(() => assertImageRef("nginx"), /tag/);
  assert.throws(() => assertImageRef("nginx:1.0 latest"), /tag/);
});
