import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = path.join(root, "deploy", "helm", "urumi", "secrets.local.yaml");

if (existsSync(target)) {
  console.log(`${target} already exists; leaving it in place`);
  process.exit(0);
}

const hex = (bytes) => randomBytes(bytes).toString("hex");
const file = `secrets:
  mariadbRootPassword: "${hex(18)}"
  mariadbPassword: "${hex(18)}"
  wordpressAdminPassword: "${hex(12)}"
  wcConsumerKey: "ck_${hex(20)}"
  wcConsumerSecret: "cs_${hex(20)}"
  postgresPassword: "${hex(18)}"
  adminEmail: "admin@agentdock.local"
  adminPassword: "${hex(12)}"
  credentialKey: "${randomBytes(32).toString("base64")}"
  groqApiKey: ""
`;

writeFileSync(target, file, "utf8");
console.log(`wrote ${target}`);
console.log("Paste a Groq API key into secrets.groqApiKey before using the chat agent.");
