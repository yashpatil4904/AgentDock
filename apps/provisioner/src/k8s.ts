import http from "node:http";
import https from "node:https";
import { KubeConfig, KubernetesObjectApi, type KubernetesObject } from "@kubernetes/client-node";

export interface K8sObject {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    resourceVersion?: string;
  };
  data?: Record<string, string>;
  stringData?: Record<string, string>;
  type?: string;
  spec?: unknown;
}

function statusCode(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "code" in error && typeof (error as { code: unknown }).code === "number") {
    return (error as { code: number }).code;
  }
  return null;
}

export function isNotFound(error: unknown): boolean {
  return statusCode(error) === 404;
}

export function isConflict(error: unknown): boolean {
  return statusCode(error) === 409;
}

export type NamespaceKind = "store" | "hosted";

export function assertManagedNamespace(namespace: string, kind: NamespaceKind): void {
  const ok = kind === "store" ? /^store-[a-z0-9-]+$/.test(namespace) : /^hosted-[a-z0-9-]+$/.test(namespace);
  if (!ok) throw new Error(`Refusing to manage namespace ${namespace}`);
}

export function assertStoreNamespace(namespace: string): void {
  assertManagedNamespace(namespace, "store");
}

function guard(obj: K8sObject, kind: NamespaceKind): void {
  if (obj.kind === "Namespace") assertManagedNamespace(obj.metadata.name, kind);
  if (obj.metadata.namespace) assertManagedNamespace(obj.metadata.namespace, kind);
}

const plurals: Record<string, string> = {
  ConfigMap: "configmaps",
  Secret: "secrets",
  Service: "services",
  Namespace: "namespaces",
  PersistentVolumeClaim: "persistentvolumeclaims",
  ResourceQuota: "resourcequotas",
  LimitRange: "limitranges",
  Deployment: "deployments",
  Job: "jobs",
  NetworkPolicy: "networkpolicies",
  Ingress: "ingresses",
};

function objectPath(obj: K8sObject, includeName: boolean): string {
  const plural = plurals[obj.kind];
  if (!plural) throw new Error(`Unsupported kind ${obj.kind}`);
  const prefix = obj.apiVersion.includes("/") ? `/apis/${obj.apiVersion}` : `/api/${obj.apiVersion}`;
  const scope = obj.metadata.namespace ? `/namespaces/${obj.metadata.namespace}/${plural}` : `/${plural}`;
  return includeName ? `${prefix}${scope}/${obj.metadata.name}` : `${prefix}${scope}`;
}

export class Cluster {
  private readonly api: KubernetesObjectApi;
  private readonly config = new KubeConfig();

  constructor() {
    this.config.loadFromCluster();
    this.api = KubernetesObjectApi.makeApiClient(this.config);
  }

  /** The generated client drops NetworkPolicy peers such as `from` during serialization. */
  private async send(method: "POST" | "PUT", obj: K8sObject): Promise<void> {
    const cluster = this.config.getCurrentCluster();
    if (!cluster?.server) throw new Error("Kubernetes cluster is not configured");
    const url = new URL(objectPath(obj, method === "PUT"), cluster.server);
    const options: https.RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    };
    await this.config.applyToHTTPSOptions(options);
    const body = JSON.stringify(obj);
    await new Promise<void>((resolve, reject) => {
      const transport = url.protocol === "http:" ? http : https;
      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 500;
          if (status < 300) {
            resolve();
            return;
          }
          const error = new Error(Buffer.concat(chunks).toString("utf8")) as Error & { code?: number };
          error.code = status;
          reject(error);
        });
      });
      req.on("error", reject);
      req.end(body);
    });
  }

  async read<T extends K8sObject>(obj: K8sObject): Promise<T> {
    return (await this.api.read({
      apiVersion: obj.apiVersion,
      kind: obj.kind,
      metadata: { name: obj.metadata.name, namespace: obj.metadata.namespace },
    })) as T;
  }

  /** Create the object, or replace it when it already exists. Used for NetworkPolicy and the store workloads whose spec must track the code. */
  async replace(obj: K8sObject, kind: NamespaceKind = "store"): Promise<void> {
    guard(obj, kind);
    try {
      const current = await this.read<K8sObject>(obj);
      const resourceVersion = (current.metadata as { resourceVersion?: string }).resourceVersion;
      await this.send("PUT", {
        ...obj,
        metadata: { ...current.metadata, ...obj.metadata, resourceVersion },
      });
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await this.send("POST", obj);
    }
  }

  async ensure(obj: K8sObject, kind: NamespaceKind = "store"): Promise<void> {
    guard(obj, kind);
    try {
      await this.read(obj);
      return;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    try {
      await this.send("POST", obj);
    } catch (error) {
      if (!isConflict(error)) throw error;
    }
  }

  /** Returns true once the object is gone. */
  async remove(obj: K8sObject, kind: NamespaceKind = "store"): Promise<boolean> {
    guard(obj, kind);
    try {
      const current = await this.read<K8sObject>(obj);
      if ((current.metadata as { deletionTimestamp?: unknown } | undefined)?.deletionTimestamp) return false;
      await this.api.delete(obj as KubernetesObject, undefined, undefined, 0, undefined, "Background");
      return false;
    } catch (error) {
      if (isNotFound(error)) return true;
      throw error;
    }
  }
}
