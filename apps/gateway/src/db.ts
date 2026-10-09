import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { decryptSecret, encryptSecret, hashPassword } from "./crypto.js";
import type { AuthType, InternalServer, PublicServer, Role, ServerStatus, User } from "./types.js";

const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let credentialKey: Buffer | null = null;

export function setCredentialKey(key: Buffer): void {
  credentialKey = key;
}

function key(): Buffer {
  if (!credentialKey) throw new Error("Credential key is not loaded");
  return credentialKey;
}

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      auth_type TEXT NOT NULL CHECK (auth_type IN ('none', 'bearer', 'header')),
      auth_header TEXT,
      credential_ciphertext TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      status TEXT NOT NULL CHECK (status IN ('connected', 'unreachable', 'disabled')),
      last_error TEXT,
      tools_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_checked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      user_email TEXT NOT NULL,
      server_slug TEXT NOT NULL,
      tool TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      duration_ms INTEGER NOT NULL,
      success BOOLEAN NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS audit_logs_started_at_idx ON audit_logs (started_at DESC);
  `);
}

export async function seed(): Promise<void> {
  const { rows } = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM users");
  if (rows[0]?.count === "0") {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    const name = process.env.ADMIN_NAME || "Admin";
    if (!email || !password) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required to seed the first admin");
    await createUser({ email, name, password, role: "admin" });
    console.log(`seeded admin ${email}`);
  }
  const servers = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM mcp_servers");
  if (servers.rows[0]?.count === "0") {
    const defaults = [
      ["WooCommerce", "woocommerce", process.env.WOOCOMMERCE_MCP_URL],
      ["Weather", "weather", process.env.WEATHER_MCP_URL],
      ["FX", "fx", process.env.FX_MCP_URL],
    ] as const;
    for (const [name, slug, url] of defaults) {
      if (!url) throw new Error(`Missing seed URL for ${slug}`);
      await insertServer({ name, slug, url, authType: "none", authHeader: null, credential: null, enabled: true });
    }
    console.log("seeded woocommerce, weather, and fx MCP servers");
  }
}

export async function createUser(input: { email: string; name: string; password: string; role: Role }): Promise<User> {
  const id = randomUUID();
  const passwordHash = await hashPassword(input.password);
  const { rows } = await pool.query<{ id: string; email: string; name: string; role: Role }>(
    "INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name, role",
    [id, input.email.toLowerCase(), input.name, passwordHash, input.role],
  );
  return rows[0] as User;
}

export async function findUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
  const { rows } = await pool.query<{ id: string; email: string; name: string; role: Role; password_hash: string }>(
    "SELECT id, email, name, role, password_hash FROM users WHERE email = $1",
    [email.toLowerCase()],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, passwordHash: row.password_hash };
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await pool.query<User>("SELECT id, email, name, role FROM users WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listUsers(): Promise<Array<User & { createdAt: string }>> {
  const { rows } = await pool.query<User & { created_at: Date }>("SELECT id, email, name, role, created_at FROM users ORDER BY created_at");
  return rows.map((row) => ({ id: row.id, email: row.email, name: row.name, role: row.role, createdAt: new Date(row.created_at).toISOString() }));
}

export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)", [id, userId, expires]);
  return id;
}

export async function deleteSession(id: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE id = $1", [id]);
}

export async function findUserBySession(id: string): Promise<User | null> {
  const { rows } = await pool.query<User>(
    `SELECT u.id, u.email, u.name, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [id],
  );
  return rows[0] ?? null;
}

export async function deleteExpiredSessions(): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE expires_at <= now()");
}

export async function insertApiKey(input: { userId: string; name: string; prefix: string; hash: string }): Promise<{ id: string }> {
  const id = randomUUID();
  await pool.query("INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix) VALUES ($1, $2, $3, $4, $5)", [id, input.userId, input.name, input.hash, input.prefix]);
  return { id };
}

export async function listApiKeys(userId?: string): Promise<Array<{ id: string; userId: string; userEmail: string; name: string; prefix: string; revokedAt: string | null; createdAt: string }>> {
  const { rows } = await pool.query<{ id: string; user_id: string; user_email: string; name: string; key_prefix: string; revoked_at: Date | null; created_at: Date }>(
    `SELECT k.id, k.user_id, u.email AS user_email, k.name, k.key_prefix, k.revoked_at, k.created_at
     FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE ($1::uuid IS NULL OR k.user_id = $1)
     ORDER BY k.created_at DESC`,
    [userId ?? null],
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    name: row.name,
    prefix: row.key_prefix,
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function revokeApiKey(id: string, userId?: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR user_id = $2)",
    [id, userId ?? null],
  );
  return (rowCount ?? 0) > 0;
}

export async function findUserByApiKeyHash(hash: string): Promise<User | null> {
  const { rows } = await pool.query<User>(
    `SELECT u.id, u.email, u.name, u.role
     FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [hash],
  );
  return rows[0] ?? null;
}

interface ServerRow {
  id: string;
  name: string;
  slug: string;
  url: string;
  auth_type: AuthType;
  auth_header: string | null;
  credential_ciphertext: string | null;
  enabled: boolean;
  status: ServerStatus;
  last_error: string | null;
  tools_json: Array<{ name: string; description?: string }>;
  last_checked_at: Date | null;
  created_at: Date;
}

function toPublic(row: ServerRow): PublicServer {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    authType: row.auth_type,
    authHeader: row.auth_header,
    hasCredential: Boolean(row.credential_ciphertext),
    enabled: row.enabled,
    status: row.status,
    lastError: row.last_error,
    tools: Array.isArray(row.tools_json) ? row.tools_json : [],
    lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toInternal(row: ServerRow): InternalServer {
  let credential: string | null = null;
  if (row.credential_ciphertext) credential = decryptSecret(row.credential_ciphertext, key());
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    authType: row.auth_type,
    authHeader: row.auth_header,
    credential,
    enabled: row.enabled,
    status: row.status,
  };
}

const serverColumns = "id, name, slug, url, auth_type, auth_header, credential_ciphertext, enabled, status, last_error, tools_json, last_checked_at, created_at";

export async function listPublicServers(): Promise<PublicServer[]> {
  const { rows } = await pool.query<ServerRow>(`SELECT ${serverColumns} FROM mcp_servers ORDER BY created_at`);
  return rows.map(toPublic);
}

export async function listEnabledInternal(): Promise<InternalServer[]> {
  const { rows } = await pool.query<ServerRow>(`SELECT ${serverColumns} FROM mcp_servers WHERE enabled = true ORDER BY created_at`);
  return rows.map(toInternal);
}

export async function getServerBySlug(slug: string): Promise<InternalServer | null> {
  const { rows } = await pool.query<ServerRow>(`SELECT ${serverColumns} FROM mcp_servers WHERE slug = $1`, [slug]);
  return rows[0] ? toInternal(rows[0]) : null;
}

export async function insertServer(input: { name: string; slug: string; url: string; authType: AuthType; authHeader: string | null; credential: string | null; enabled: boolean }): Promise<PublicServer> {
  const id = randomUUID();
  const ciphertext = input.credential ? encryptSecret(input.credential, key()) : null;
  const status: ServerStatus = input.enabled ? "unreachable" : "disabled";
  const { rows } = await pool.query<ServerRow>(
    `INSERT INTO mcp_servers (id, name, slug, url, auth_type, auth_header, credential_ciphertext, enabled, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${serverColumns}`,
    [id, input.name, input.slug, input.url, input.authType, input.authHeader, ciphertext, input.enabled, status],
  );
  return toPublic(rows[0] as ServerRow);
}

export async function updateServer(id: string, input: { name: string; url: string; authType: AuthType; authHeader: string | null; credential?: string | null; clearCredential: boolean; enabled: boolean }): Promise<PublicServer | null> {
  const existing = await pool.query<ServerRow>(`SELECT ${serverColumns} FROM mcp_servers WHERE id = $1`, [id]);
  const row = existing.rows[0];
  if (!row) return null;
  let ciphertext = row.credential_ciphertext;
  if (input.authType === "none" || input.clearCredential) ciphertext = null;
  else if (input.credential) ciphertext = encryptSecret(input.credential, key());
  const status: ServerStatus = input.enabled ? "unreachable" : "disabled";
  const { rows } = await pool.query<ServerRow>(
    `UPDATE mcp_servers
     SET name = $2, url = $3, auth_type = $4, auth_header = $5, credential_ciphertext = $6, enabled = $7,
         status = $8, last_error = NULL, tools_json = '[]'::jsonb
     WHERE id = $1
     RETURNING ${serverColumns}`,
    [id, input.name, input.url, input.authType, input.authHeader, ciphertext, input.enabled, status],
  );
  return rows[0] ? toPublic(rows[0]) : null;
}

export async function deleteServer(id: string): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM mcp_servers WHERE id = $1", [id]);
  return (rowCount ?? 0) > 0;
}

export async function markServer(id: string, status: ServerStatus, lastError: string | null, tools: Array<{ name: string; description?: string }>): Promise<void> {
  await pool.query(
    "UPDATE mcp_servers SET status = $2, last_error = $3, tools_json = $4::jsonb, last_checked_at = now() WHERE id = $1 AND enabled = true",
    [id, status, lastError, JSON.stringify(tools)],
  );
}

export async function insertAudit(entry: { userId: string; userEmail: string; serverSlug: string; tool: string; startedAt: Date; durationMs: number; success: boolean; error: string | null }): Promise<void> {
  await pool.query(
    `INSERT INTO audit_logs (id, user_id, user_email, server_slug, tool, started_at, duration_ms, success, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [randomUUID(), entry.userId, entry.userEmail, entry.serverSlug, entry.tool, entry.startedAt, entry.durationMs, entry.success, entry.error],
  );
}

export async function listAudit(userId?: string): Promise<Array<{ id: string; userEmail: string; serverSlug: string; tool: string; startedAt: string; durationMs: number; success: boolean; error: string | null }>> {
  const { rows } = await pool.query<{ id: string; user_email: string; server_slug: string; tool: string; started_at: Date; duration_ms: number; success: boolean; error: string | null }>(
    `SELECT id, user_email, server_slug, tool, started_at, duration_ms, success, error
     FROM audit_logs
     WHERE ($1::uuid IS NULL OR user_id = $1)
     ORDER BY started_at DESC
     LIMIT 200`,
    [userId ?? null],
  );
  return rows.map((row) => ({
    id: row.id,
    userEmail: row.user_email,
    serverSlug: row.server_slug,
    tool: row.tool,
    startedAt: new Date(row.started_at).toISOString(),
    durationMs: row.duration_ms,
    success: row.success,
    error: row.error,
  }));
}
