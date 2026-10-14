import assert from "node:assert/strict";
import test from "node:test";
import { rateAllowed } from "./rate.js";

test("a full minute window rejects the next call", () => {
  assert.equal(rateAllowed(119, 120), true);
  assert.equal(rateAllowed(120, 120), false);
});
