import { randomBytes } from "node:crypto";
import type { ProvisionerConfig } from "./config.js";
import { nextProvisionStep, type JobState } from "./decide.js";
import { credentialKeyFromEnv, decryptSecret } from "./crypto.js";
import {
  clearAdminPassword,
  deleteStoreRow,
  markStoreFailed,
  markStoreReady,
  registerMcpServer,
  setStoreDetail,
  unregisterMcpServer,
  type StoreRecord,
} from "./db.js";
import { Cluster, isNotFound, type K8sObject } from "./k8s.js";
import { storeObjects, type StoreScripts, type StoreSecret } from "./resources.js";

interface JobView {
  status?: {
    succeeded?: number;
    conditions?: Array<{ type?: string; status?: string }>;
  };
}

interface DeploymentView {
  status?: { readyReplicas?: number };
}

function jobState(job: JobView | null): JobState {
  if (!job) return "missing";
  if ((job.status?.succeeded ?? 0) > 0) return "succeeded";
  if (job.status?.conditions?.some((condition) => condition.type === "Failed" && condition.status === "True")) return "failed";
  return "running";
}

function newSecret(adminPassword: string): StoreSecret {
  const password = () => randomBytes(24).toString("base64url");
  return {
    rootPassword: password(),
    dbPassword: password(),
    adminPassword,
    consumerKey: `ck_${randomBytes(16).toString("hex")}`,
    consumerSecret: `cs_${randomBytes(16).toString("hex")}`,
  };
}

async function readOrNull<T extends K8sObject>(cluster: Cluster, obj: K8sObject): Promise<T | null> {
  try {
    return await cluster.read<T>(obj);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function reconcileStore(store: StoreRecord, cluster: Cluster, config: ProvisionerConfig, scripts: StoreScripts): Promise<void> {
  if (store.status === "deleting") {
    await unregisterMcpServer(store.slug);
    const gone = await cluster.remove({
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: store.namespace },
    });
    if (gone) await deleteStoreRow(store.id);
    else await setStoreDetail(store.id, "Deleting the namespace, volumes, Secrets, and ingress");
    return;
  }

  const secretHeader: K8sObject = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "shop", namespace: store.namespace },
  };
  const existingSecret = await readOrNull(cluster, secretHeader);
  let adminPassword = "already-stored";
  if (!existingSecret) {
    if (!store.adminPasswordCiphertext) {
      await markStoreFailed(store.id, "No WooCommerce admin password was saved for this store. Delete it and create it again.");
      return;
    }
    adminPassword = decryptSecret(store.adminPasswordCiphertext, credentialKeyFromEnv(process.env.GATEWAY_CREDENTIAL_KEY));
  }
  const objects = storeObjects(store, config, newSecret(adminPassword), scripts);
  for (const obj of objects) {
    if (obj.kind === "Job") continue;
    await cluster.ensure(obj);
  }
  await clearAdminPassword(store.id);
  const job = objects.find((obj) => obj.kind === "Job");
  if (!job) throw new Error("Bootstrap job was not built");

  const currentJob = await readOrNull<JobView & K8sObject>(cluster, job);
  const mcp = await readOrNull<DeploymentView & K8sObject>(cluster, {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "woocommerce-mcp", namespace: store.namespace },
  });
  const step = nextProvisionStep({
    elapsedMs: Date.now() - store.provisionStartedAt.getTime(),
    timeoutMs: config.timeoutMs,
    job: jobState(currentJob),
    mcpReady: (mcp?.status?.readyReplicas ?? 0) >= 1,
    registered: Boolean(store.mcpServerId),
  });

  if (step.action === "fail") {
    await markStoreFailed(store.id, step.reason);
    return;
  }
  if (step.action === "create-job") {
    await cluster.ensure(job);
    await setStoreDetail(store.id, step.detail);
    return;
  }
  if (step.action === "recreate-job") {
    await cluster.remove(job);
    await setStoreDetail(store.id, step.detail);
    return;
  }
  if (step.action === "register" || step.action === "ready") {
    const mcpServerId = store.mcpServerId ?? (await registerMcpServer(store));
    await markStoreReady(store.id, mcpServerId);
    return;
  }
  await setStoreDetail(store.id, step.detail);
}
