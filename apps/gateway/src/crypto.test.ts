import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptSecret, encryptSecret, generateApiKey, hashApiKey, hashPassword, verifyPassword } from "./crypto.js";

test("passwords verify and reject a wrong password", async () => {
  const stored = await hashPassword("correct-horse");
  assert.equal(await verifyPassword("correct-horse", stored), true);
  assert.equal(await verifyPassword("wrong-horse", stored), false);
});

test("API keys are stored as a sha256 hash and shown by prefix only", () => {
  const generated = generateApiKey();
  assert.equal(generated.hash, hashApiKey(generated.token));
  assert.equal(generated.prefix, generated.token.slice(0, 12));
  assert.notEqual(generated.hash, generated.token);
});

test("upstream credentials round-trip through AES-GCM", () => {
  const key = Buffer.alloc(32, 7);
  const encrypted = encryptSecret("ck_secret", key);
  assert.equal(decryptSecret(encrypted, key), "ck_secret");
  assert.notEqual(encrypted, "ck_secret");
});
