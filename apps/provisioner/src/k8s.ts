import { KubeConfig, KubernetesObjectApi, type KubernetesObject } from "@kubernetes/client-node";

export interface K8sObject {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
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

export function assertStoreNamespace(namespace: string): void {
  if (!/^store-[a-z0-9-]+$/.test(namespace)) {
    throw new Error(`Refusing to manage namespace ${namespace}`);
  }
}

export class Cluster {
  private readonly api: KubernetesObjectApi;

  constructor() {
    const config = new KubeConfig();
    config.loadFromCluster();
    this.api = KubernetesObjectApi.makeApiClient(config);
  }

  async read<T extends K8sObject>(obj: K8sObject): Promise<T> {
    return (await this.api.read({
      apiVersion: obj.apiVersion,
      kind: obj.kind,
      metadata: { name: obj.metadata.name, namespace: obj.metadata.namespace },
    })) as T;
  }

  async ensure(obj: K8sObject): Promise<void> {
    if (obj.metadata.namespace) assertStoreNamespace(obj.metadata.namespace);
    if (obj.kind === "Namespace") assertStoreNamespace(obj.metadata.name);
    try {
      await this.read(obj);
      return;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    try {
      await this.api.create(obj as KubernetesObject);
    } catch (error) {
      if (!isConflict(error)) throw error;
    }
  }

  /** Returns true once the object is gone. */
  async remove(obj: K8sObject): Promise<boolean> {
    if (obj.metadata.namespace) assertStoreNamespace(obj.metadata.namespace);
    if (obj.kind === "Namespace") assertStoreNamespace(obj.metadata.name);
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
