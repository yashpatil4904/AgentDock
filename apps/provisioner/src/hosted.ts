import { randomUUID } from "node:crypto";
import type { ProvisionerConfig } from "./config.js";
import { credentialKeyFromEnv, decryptSecret } from "./crypto.js";
import { pool, unregisterMcpServer } from "./db.js";
import { Cluster, isNotFound, type K8sObject } from "./k8s.js";

export interface HostedRecord {
  id: string;
  name: string;
  slug: string;
  image: string;
  namespace: string;
  status: "provisioning" | "deleting";
  envCiphertext: string | null;
  mcpServerId: string | null;
  provisionStartedAt: Date;
}

interface DeploymentView {
  status?: { readyReplicas?: number };
}

function labels(namespace: string): Record<string, string> {
  return { "app.kubernetes.io/name": "hosted-mcp", "app.kubernetes.io/part-of": "agentdock", "agentdock/namespace": namespace };
}

function objects(row: HostedRecord, config: ProvisionerConfig, env: Array<{ name: string; value: string }>): K8sObject[] {
  const meta = (name: string) => ({ name, namespace: row.namespace, labels: labels(row.namespace) });
  return [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: row.namespace, labels: { "kubernetes.io/metadata.name": row.namespace, ...labels(row.namespace) } } },
    {
      apiVersion: "v1",
      kind: "ResourceQuota",
      metadata: meta("hosted"),
      spec: {
        hard: {
          pods: "4",
          "requests.cpu": "1",
          "requests.memory": "1Gi",
          "limits.cpu": "2",
          "limits.memory": "2Gi",
          services: "3",
        },
      },
    },
    {
      apiVersion: "v1",
      kind: "LimitRange",
      metadata: meta("hosted"),
      spec: {
        limits: [{
          type: "Container",
          default: { cpu: "200m", memory: "256Mi" },
          defaultRequest: { cpu: "50m", memory: "64Mi" },
          max: { cpu: "1", memory: "1Gi" },
        }],
      },
    },
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: meta("mcp"),
      type: "Opaque",
      stringData: Object.fromEntries(env.map((item) => [item.name, item.value])),
    },
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: meta("mcp"),
      spec: {
        replicas: 1,
        selector: { matchLabels: { "app.kubernetes.io/name": "hosted-mcp" } },
        template: {
          metadata: { labels: labels(row.namespace) },
          spec: {
            containers: [{
              name: "mcp",
              image: row.image,
              imagePullPolicy: config.pullPolicy,
              ports: [{ name: "http", containerPort: 8080 }],
              envFrom: [{ secretRef: { name: "mcp" } }],
              resources: config.resources.mcp,
              securityContext: { allowPrivilegeEscalation: false },
              readinessProbe: { tcpSocket: { port: "http" }, initialDelaySeconds: 5, periodSeconds: 10 },
              livenessProbe: { tcpSocket: { port: "http" }, initialDelaySeconds: 20, periodSeconds: 20 },
            }],
          },
        },
      },
    },
    {
      apiVersion: "v1",
      kind: "Service",
      metadata: meta("mcp"),
      spec: { selector: { "app.kubernetes.io/name": "hosted-mcp" }, ports: [{ name: "http", port: 8080, targetPort: "http" }] },
    },
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: meta("default-deny"),
      spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"] },
    },
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: meta("mcp"),
      spec: {
        podSelector: { matchLabels: { "app.kubernetes.io/name": "hosted-mcp" } },
        policyTypes: ["Ingress", "Egress"],
        ingress: [{
          from: [{
            namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": config.gatewayNamespace } },
            podSelector: { matchLabels: { "app.kubernetes.io/name": "gateway" } },
          }],
          ports: [{ protocol: "TCP", port: 8080 }],
        }],
        egress: [
          { to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }], ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }] },
          { ports: [{ protocol: "TCP", port: 80 }, { protocol: "TCP", port: 443 }] },
        ],
      },
    },
  ];
}

async function activeHosted(): Promise<HostedRecord[]> {
  const { rows } = await pool.query<{
    id: string; name: string; slug: string; image: string; namespace: string; status: "provisioning" | "deleting";
    env_ciphertext: string | null; mcp_server_id: string | null; provision_started_at: Date;
  }>(
    `SELECT id, name, slug, image, namespace, status, env_ciphertext, mcp_server_id, provision_started_at
     FROM hosted_servers WHERE status IN ('provisioning', 'deleting')`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    image: row.image,
    namespace: row.namespace,
    status: row.status,
    envCiphertext: row.env_ciphertext,
    mcpServerId: row.mcp_server_id,
    provisionStartedAt: new Date(row.provision_started_at),
  }));
}

async function register(row: HostedRecord): Promise<string> {
  const url = `http://mcp.${row.namespace}.svc.cluster.local:8080/mcp`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO mcp_servers (id, name, slug, url, auth_type, auth_header, credential_ciphertext, enabled, status)
     VALUES ($1, $2, $3, $4, 'none', NULL, NULL, true, 'unreachable')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, enabled = true
     RETURNING id`,
    [randomUUID(), row.name, row.slug, url],
  );
  return rows[0]?.id as string;
}

export async function reconcileHostedServers(cluster: Cluster, config: ProvisionerConfig): Promise<void> {
  let rows: HostedRecord[] = [];
  try {
    rows = await activeHosted();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/hosted_servers/.test(message)) return;
    throw error;
  }
  await Promise.all(rows.map(async (row) => {
    try {
      await reconcileOne(row, cluster, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Hosted server step failed";
      console.error(`hosted ${row.slug}: ${message}`);
      await pool.query(
        "UPDATE hosted_servers SET detail = $2, updated_at = now() WHERE id = $1 AND status IN ('provisioning', 'deleting')",
        [row.id, message.slice(0, 500)],
      );
    }
  }));
}

async function reconcileOne(row: HostedRecord, cluster: Cluster, config: ProvisionerConfig): Promise<void> {
  if (row.status === "deleting") {
    await unregisterMcpServer(row.slug);
    const gone = await cluster.remove({ apiVersion: "v1", kind: "Namespace", metadata: { name: row.namespace } }, "hosted");
    if (gone) await pool.query("DELETE FROM hosted_servers WHERE id = $1 AND status = 'deleting'", [row.id]);
    else await pool.query("UPDATE hosted_servers SET detail = $2, updated_at = now() WHERE id = $1", [row.id, "Deleting the namespace, Secret, and NetworkPolicy"]);
    return;
  }

  const elapsed = Date.now() - row.provisionStartedAt.getTime();
  if (elapsed > config.timeoutMs) {
    const seconds = Math.round(config.timeoutMs / 1000);
    await pool.query(
      "UPDATE hosted_servers SET status = 'failed', error = $2, detail = NULL, updated_at = now() WHERE id = $1 AND status = 'provisioning'",
      [row.id, `Provisioning timed out after ${seconds} seconds while waiting for the container. Retry keeps this namespace and continues.`],
    );
    return;
  }

  let env: Array<{ name: string; value: string }> = [];
  if (row.envCiphertext) env = JSON.parse(decryptSecret(row.envCiphertext, credentialKeyFromEnv(process.env.GATEWAY_CREDENTIAL_KEY))) as Array<{ name: string; value: string }>;
  const built = objects(row, config, env);
  for (const obj of built) {
    if (obj.kind === "Secret") {
      try {
        await cluster.read(obj);
      } catch (error) {
        if (!isNotFound(error)) throw error;
        await cluster.ensure(obj, "hosted");
      }
    } else {
      await cluster.ensure(obj, "hosted");
    }
  }
  if (row.envCiphertext) {
    await pool.query("UPDATE hosted_servers SET env_ciphertext = NULL, updated_at = now() WHERE id = $1", [row.id]);
  }

  const deployment = await cluster.read<DeploymentView & K8sObject>({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "mcp", namespace: row.namespace },
  }).catch((error: unknown) => {
    if (isNotFound(error)) return null;
    throw error;
  });
  if ((deployment?.status?.readyReplicas ?? 0) < 1) {
    await pool.query("UPDATE hosted_servers SET detail = $2, updated_at = now() WHERE id = $1", [row.id, "Waiting for the hosted MCP server"]);
    return;
  }
  const mcpId = row.mcpServerId ?? await register(row);
  await pool.query(
    "UPDATE hosted_servers SET status = 'ready', mcp_server_id = $2, error = NULL, detail = NULL, updated_at = now() WHERE id = $1 AND status = 'provisioning'",
    [row.id, mcpId],
  );
}
