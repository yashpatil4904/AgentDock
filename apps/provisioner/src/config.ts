export interface ContainerResources {
  requests: { cpu: string; memory: string };
  limits: { cpu: string; memory: string };
}

export interface ProvisionerConfig {
  timeoutMs: number;
  ingressClass: string;
  storageClass: string;
  ingressNamespace: string;
  gatewayNamespace: string;
  ingressPodLabels: Record<string, string>;
  tlsCertResolver: string;
  certManager: boolean;
  mariadbImage: string;
  wordpressImage: string;
  wordpressCliImage: string;
  mcpImage: string;
  pullPolicy: string;
  mariadbStorage: string;
  wordpressStorage: string;
  resources: {
    mariadb: ContainerResources;
    wordpress: ContainerResources;
    mcp: ContainerResources;
  };
  scriptsDir: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function resourcesFrom(value: string): ContainerResources {
  const parsed = JSON.parse(value) as ContainerResources;
  if (!parsed?.requests?.cpu || !parsed?.limits?.memory) throw new Error("Container resources are incomplete");
  return parsed;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ProvisionerConfig {
  const timeoutSeconds = Number(env.STORE_TIMEOUT_SECONDS ?? 900);
  const ingressPodLabels = JSON.parse(required(env, "INGRESS_POD_LABELS")) as Record<string, string>;
  const resources = JSON.parse(required(env, "RESOURCES_JSON")) as ProvisionerConfig["resources"];
  return {
    timeoutMs: (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : 900) * 1000,
    ingressClass: required(env, "INGRESS_CLASS"),
    storageClass: env.STORAGE_CLASS ?? "",
    ingressNamespace: required(env, "INGRESS_NAMESPACE"),
    gatewayNamespace: required(env, "GATEWAY_NAMESPACE"),
    ingressPodLabels,
    tlsCertResolver: env.TLS_CERT_RESOLVER ?? "",
    certManager: env.CERT_MANAGER === "true",
    mariadbImage: required(env, "MARIADB_IMAGE"),
    wordpressImage: required(env, "WORDPRESS_IMAGE"),
    wordpressCliImage: required(env, "WORDPRESS_CLI_IMAGE"),
    mcpImage: required(env, "WOOCOMMERCE_MCP_IMAGE"),
    pullPolicy: env.IMAGE_PULL_POLICY || "IfNotPresent",
    mariadbStorage: env.MARIADB_STORAGE || "5Gi",
    wordpressStorage: env.WORDPRESS_STORAGE || "5Gi",
    resources: {
      mariadb: resourcesFrom(JSON.stringify(resources.mariadb)),
      wordpress: resourcesFrom(JSON.stringify(resources.wordpress)),
      mcp: resourcesFrom(JSON.stringify(resources.mcp)),
    },
    scriptsDir: env.SCRIPTS_DIR || "scripts",
  };
}
