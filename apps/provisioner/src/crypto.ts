import { createDecipheriv } from "node:crypto";

export function credentialKeyFromEnv(value: string | undefined): Buffer {
  if (!value) throw new Error("GATEWAY_CREDENTIAL_KEY is required");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("GATEWAY_CREDENTIAL_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function decryptSecret(payload: string, key: Buffer): string {
  const buffer = Buffer.from(payload, "base64");
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const ciphertext = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
