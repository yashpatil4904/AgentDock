import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export type StoreStatus = "provisioning" | "ready" | "failed" | "deleting";

export interface StoreRecord {
  id: string;
  name: string;
  slug: string;
  namespace: string;
  status: StoreStatus;
  url: string;
  mcpServerId: string | null;
  provisionStartedAt: Date;
  adminPasswordCiphertext: string | null;
}

interface StoreSqlRow {
  id: string;
  name: string;
  slug: string;
  namespace: string;
  status: StoreStatus;
  url: string;
  mcp_server_id: string | null;
  provision_started_at: Date;
  admin_password_ciphertext: string | null;
}

function mapStore(row: StoreSqlRow): StoreRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    namespace: row.namespace,
    status: row.status,
    url: row.url,
    mcpServerId: row.mcp_server_id,
    provisionStartedAt: new Date(row.provision_started_at),
    adminPasswordCiphertext: row.admin_password_ciphertext,
  };
}

export async function activeStores(): Promise<StoreRecord[]> {
  const { rows } = await pool.query<StoreSqlRow>(
    `SELECT id, name, slug, namespace, status, url, mcp_server_id, provision_started_at, admin_password_ciphertext
     FROM stores WHERE status IN ('provisioning', 'deleting') ORDER BY created_at`,
  );
  return rows.map(mapStore);
}

export async function clearAdminPassword(id: string): Promise<void> {
  await pool.query(
    "UPDATE stores SET admin_password_ciphertext = NULL, updated_at = now() WHERE id = $1 AND admin_password_ciphertext IS NOT NULL",
    [id],
  );
}

export async function setStoreDetail(id: string, detail: string): Promise<void> {
  await pool.query(
    "UPDATE stores SET detail = $2, updated_at = now() WHERE id = $1 AND status IN ('provisioning', 'deleting')",
    [id, detail.slice(0, 500)],
  );
}

export async function markStoreFailed(id: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE stores SET status = 'failed', error = $2, detail = NULL, updated_at = now()
     WHERE id = $1 AND status = 'provisioning'`,
    [id, reason.slice(0, 800)],
  );
}

export async function markStoreReady(id: string, mcpServerId: string): Promise<void> {
  await pool.query(
    `UPDATE stores SET status = 'ready', mcp_server_id = $2, error = NULL, detail = NULL, updated_at = now()
     WHERE id = $1 AND status = 'provisioning'`,
    [id, mcpServerId],
  );
}

export async function registerMcpServer(store: StoreRecord): Promise<string> {
  const url = `http://woocommerce-mcp.${store.namespace}.svc.cluster.local:8080/mcp`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO mcp_servers (id, name, slug, url, auth_type, auth_header, credential_ciphertext, enabled, status)
     VALUES ($1, $2, $3, $4, 'none', NULL, NULL, true, 'unreachable')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, enabled = true
     RETURNING id`,
    [randomUUID(), store.name, store.slug, url],
  );
  return rows[0]?.id as string;
}

export async function unregisterMcpServer(slug: string): Promise<void> {
  if (slug === "woocommerce" || slug === "weather" || slug === "fx") {
    throw new Error(`Refusing to unregister the platform server ${slug}`);
  }
  await pool.query("DELETE FROM mcp_servers WHERE slug = $1", [slug]);
}

export async function deleteStoreRow(id: string): Promise<void> {
  await pool.query("DELETE FROM stores WHERE id = $1 AND status = 'deleting'", [id]);
}
