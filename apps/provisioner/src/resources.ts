import type { ProvisionerConfig } from "./config.js";
import type { K8sObject } from "./k8s.js";
import type { StoreRecord } from "./db.js";

export interface StoreSecret {
  rootPassword: string;
  dbPassword: string;
  adminPassword: string;
  consumerKey: string;
  consumerSecret: string;
}

function labels(name: string, slug: string): Record<string, string> {
  return {
    "app.kubernetes.io/name": name,
    "app.kubernetes.io/part-of": "agentdock",
    "app.kubernetes.io/instance": slug,
  };
}

function meta(store: StoreRecord, name: string, kindName = name): K8sObject["metadata"] {
  return {
    name,
    namespace: store.namespace,
    labels: labels(kindName, store.slug),
  };
}

export interface StoreScripts {
  sh: string;
  php: string;
  look: string;
}

export function storeObjects(store: StoreRecord, config: ProvisionerConfig, secret: StoreSecret, scripts: StoreScripts): K8sObject[] {
  const ns = store.namespace;
  const wordpressConfig = [
    `define('WP_HOME', '${store.url}');`,
    `define('WP_SITEURL', '${store.url}');`,
    "if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') { $_SERVER['HTTPS'] = 'on'; }",
    "$agentdockUri = $_SERVER['REQUEST_URI'] ?? '';",
    "if (str_contains($agentdockUri, '/wp-json/') || str_contains($agentdockUri, 'rest_route=')) { $_SERVER['HTTPS'] = 'on'; }",
  ].join("\n");

  const namespace: K8sObject = {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name: ns,
      labels: {
        "app.kubernetes.io/name": "store",
        "app.kubernetes.io/part-of": "agentdock",
        "app.kubernetes.io/instance": store.slug,
      },
    },
  };

  const quota: K8sObject = {
    apiVersion: "v1",
    kind: "ResourceQuota",
    metadata: meta(store, "store"),
    spec: {
      hard: {
        pods: "8",
        "requests.cpu": "1",
        "requests.memory": "2Gi",
        "limits.cpu": "4",
        "limits.memory": "4Gi",
        persistentvolumeclaims: "2",
        "requests.storage": "12Gi",
        services: "6",
        "count/jobs.batch": "2",
        "count/deployments.apps": "4",
        "count/configmaps": "10",
        "count/secrets": "10",
        "count/ingresses.networking.k8s.io": "2",
        "count/networkpolicies.networking.k8s.io": "8",
      },
    },
  };

  const limitRange: K8sObject = {
    apiVersion: "v1",
    kind: "LimitRange",
    metadata: meta(store, "store"),
    spec: {
      limits: [
        {
          type: "Container",
          default: { cpu: "200m", memory: "256Mi" },
          defaultRequest: { cpu: "50m", memory: "64Mi" },
          max: { cpu: "2", memory: "2Gi" },
          min: { cpu: "10m", memory: "32Mi" },
        },
      ],
    },
  };

  const credentials: K8sObject = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: meta(store, "shop", "shop"),
    type: "Opaque",
    stringData: {
      MARIADB_ROOT_PASSWORD: secret.rootPassword,
      MARIADB_DATABASE: "woocommerce",
      MARIADB_USER: "woocommerce",
      MARIADB_PASSWORD: secret.dbPassword,
      WORDPRESS_DB_NAME: "woocommerce",
      WORDPRESS_DB_USER: "woocommerce",
      WORDPRESS_DB_PASSWORD: secret.dbPassword,
      WORDPRESS_ADMIN_PASSWORD: secret.adminPassword,
      WC_CONSUMER_KEY: secret.consumerKey,
      WC_CONSUMER_SECRET: secret.consumerSecret,
    },
  };

  const scriptsMap: K8sObject = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: meta(store, "wc-bootstrap", "wc-bootstrap"),
    data: {
      "wc-setup.sh": scripts.sh,
      "wc-setup.php": scripts.php,
      "agentdock-look.php": scripts.look,
    },
  };

  const mariadbPvc = pvc(store, "mariadb", config.mariadbStorage, config.storageClass);
  const wordpressPvc = pvc(store, "wordpress", config.wordpressStorage, config.storageClass);

  const mariadb: K8sObject = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: meta(store, "mariadb"),
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: { matchLabels: { "app.kubernetes.io/name": "mariadb" } },
      template: {
        metadata: { labels: labels("mariadb", store.slug) },
        spec: {
          securityContext: { runAsNonRoot: true, runAsUser: 999, runAsGroup: 999, fsGroup: 999 },
          containers: [
            {
              name: "mariadb",
              image: config.mariadbImage,
              securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
              imagePullPolicy: config.pullPolicy,
              args: ["--character-set-server=utf8mb4", "--collation-server=utf8mb4_unicode_ci"],
              ports: [{ name: "mysql", containerPort: 3306 }],
              env: [
                { name: "MARIADB_ROOT_PASSWORD", valueFrom: { secretKeyRef: { name: "shop", key: "MARIADB_ROOT_PASSWORD" } } },
                { name: "MARIADB_DATABASE", valueFrom: { secretKeyRef: { name: "shop", key: "MARIADB_DATABASE" } } },
                { name: "MARIADB_USER", valueFrom: { secretKeyRef: { name: "shop", key: "MARIADB_USER" } } },
                { name: "MARIADB_PASSWORD", valueFrom: { secretKeyRef: { name: "shop", key: "MARIADB_PASSWORD" } } },
              ],
              resources: config.resources.mariadb,
              readinessProbe: { exec: { command: ["healthcheck.sh", "--connect", "--innodb_initialized"] }, initialDelaySeconds: 20, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 12 },
              livenessProbe: { exec: { command: ["healthcheck.sh", "--connect"] }, initialDelaySeconds: 40, periodSeconds: 20, timeoutSeconds: 5, failureThreshold: 6 },
              volumeMounts: [{ name: "data", mountPath: "/var/lib/mysql" }],
            },
          ],
          volumes: [{ name: "data", persistentVolumeClaim: { claimName: "mariadb" } }],
        },
      },
    },
  };

  const wordpress: K8sObject = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: meta(store, "wordpress"),
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: { matchLabels: { "app.kubernetes.io/name": "wordpress" } },
      template: {
        metadata: { labels: labels("wordpress", store.slug) },
        spec: {
          securityContext: { fsGroup: 33 },
          initContainers: [
            {
              name: "prepare",
              image: config.wordpressImage,
              imagePullPolicy: config.pullPolicy,
              command: ["docker-entrypoint.sh", "apache2", "-v"],
              env: [
                { name: "WORDPRESS_DB_HOST", value: "mariadb" },
                { name: "WORDPRESS_DB_NAME", valueFrom: { secretKeyRef: { name: "shop", key: "WORDPRESS_DB_NAME" } } },
                { name: "WORDPRESS_DB_USER", valueFrom: { secretKeyRef: { name: "shop", key: "WORDPRESS_DB_USER" } } },
                { name: "WORDPRESS_DB_PASSWORD", valueFrom: { secretKeyRef: { name: "shop", key: "WORDPRESS_DB_PASSWORD" } } },
                { name: "WORDPRESS_CONFIG_EXTRA", value: wordpressConfig },
              ],
              volumeMounts: [{ name: "data", mountPath: "/var/www/html" }],
              securityContext: { runAsUser: 0 },
            },
          ],
          containers: [
            {
              name: "wordpress",
              image: config.wordpressImage,
              imagePullPolicy: config.pullPolicy,
              command: ["sh", "-c", "mkdir -p /tmp/apache2 && exec apache2 -DFOREGROUND"],
              ports: [{ name: "http", containerPort: 8080 }],
              securityContext: {
                runAsNonRoot: true,
                runAsUser: 33,
                runAsGroup: 33,
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
              },
              env: [
                { name: "APACHE_RUN_DIR", value: "/tmp/apache2" },
                { name: "APACHE_PID_FILE", value: "/tmp/apache2.pid" },
                { name: "APACHE_LOCK_DIR", value: "/tmp" },
                { name: "APACHE_RUN_USER", value: "www-data" },
                { name: "APACHE_RUN_GROUP", value: "www-data" },
                { name: "APACHE_LOG_DIR", value: "/tmp" },
                { name: "WORDPRESS_DB_HOST", value: "mariadb" },
                { name: "WORDPRESS_DB_NAME", valueFrom: { secretKeyRef: { name: "shop", key: "WORDPRESS_DB_NAME" } } },
                { name: "WORDPRESS_DB_USER", valueFrom: { secretKeyRef: { name: "shop", key: "WORDPRESS_DB_USER" } } },
                { name: "WORDPRESS_DB_PASSWORD", valueFrom: { secretKeyRef: { name: "shop", key: "WORDPRESS_DB_PASSWORD" } } },
                { name: "WORDPRESS_CONFIG_EXTRA", value: wordpressConfig },
              ],
              resources: config.resources.wordpress,
              readinessProbe: { httpGet: { path: "/wp-login.php", port: "http" }, initialDelaySeconds: 20, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 12 },
              livenessProbe: { httpGet: { path: "/wp-login.php", port: "http" }, initialDelaySeconds: 40, periodSeconds: 20, timeoutSeconds: 5, failureThreshold: 6 },
              volumeMounts: [
                { name: "data", mountPath: "/var/www/html" },
                { name: "apache-ports", mountPath: "/etc/apache2/ports.conf", subPath: "ports.conf" },
                { name: "apache-site", mountPath: "/etc/apache2/sites-enabled/000-default.conf", subPath: "000-default.conf" },
                { name: "apache-nonroot", mountPath: "/etc/apache2/conf-enabled/nonroot.conf", subPath: "nonroot.conf" },
              ],
            },
          ],
          volumes: [
            { name: "data", persistentVolumeClaim: { claimName: "wordpress" } },
            { name: "apache-ports", configMap: { name: "wordpress-apache", items: [{ key: "ports.conf", path: "ports.conf" }] } },
            { name: "apache-site", configMap: { name: "wordpress-apache", items: [{ key: "000-default.conf", path: "000-default.conf" }] } },
            { name: "apache-nonroot", configMap: { name: "wordpress-apache", items: [{ key: "nonroot.conf", path: "nonroot.conf" }] } },
          ],
        },
      },
    },
  };

  const mcp: K8sObject = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: meta(store, "woocommerce-mcp"),
    spec: {
      replicas: 1,
      selector: { matchLabels: { "app.kubernetes.io/name": "woocommerce-mcp" } },
      template: {
        metadata: { labels: labels("woocommerce-mcp", store.slug) },
        spec: {
          securityContext: { runAsNonRoot: true, runAsUser: 1000 },
          containers: [
            {
              name: "woocommerce-mcp",
              image: config.mcpImage,
              imagePullPolicy: config.pullPolicy,
              ports: [{ name: "http", containerPort: 8080 }],
              env: [
                { name: "PORT", value: "8080" },
                { name: "WC_BASE_URL", value: `http://wordpress.${ns}.svc.cluster.local` },
                { name: "WC_CONSUMER_KEY", valueFrom: { secretKeyRef: { name: "shop", key: "WC_CONSUMER_KEY" } } },
                { name: "WC_CONSUMER_SECRET", valueFrom: { secretKeyRef: { name: "shop", key: "WC_CONSUMER_SECRET" } } },
              ],
              resources: config.resources.mcp,
              readinessProbe: { httpGet: { path: "/healthz", port: "http" }, initialDelaySeconds: 5, periodSeconds: 10, timeoutSeconds: 3, failureThreshold: 6 },
              livenessProbe: { httpGet: { path: "/healthz", port: "http" }, initialDelaySeconds: 20, periodSeconds: 20, timeoutSeconds: 3, failureThreshold: 5 },
              securityContext: { allowPrivilegeEscalation: false },
            },
          ],
        },
      },
    },
  };

  const job: K8sObject = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: meta(store, "wc-bootstrap", "wc-bootstrap"),
    spec: {
      backoffLimit: 4,
      activeDeadlineSeconds: 1200,
      ttlSecondsAfterFinished: 86400,
      template: {
        metadata: { labels: labels("wc-bootstrap", store.slug) },
        spec: {
          restartPolicy: "OnFailure",
          securityContext: { runAsUser: 0 },
          containers: [
            {
              name: "bootstrap",
              image: config.wordpressCliImage,
              imagePullPolicy: config.pullPolicy,
              command: ["bash", "/scripts/wc-setup.sh"],
              env: [
                { name: "WORDPRESS_DB_HOST", value: "mariadb" },
                { name: "WORDPRESS_DB_NAME", valueFrom: { secretKeyRef: { name: "shop", key: "WORDPRESS_DB_NAME" } } },
                { name: "WORDPRESS_DB_USER", valueFrom: { secretKeyRef: { name: "shop", key: "WORDPRESS_DB_USER" } } },
                { name: "WORDPRESS_DB_PASSWORD", valueFrom: { secretKeyRef: { name: "shop", key: "WORDPRESS_DB_PASSWORD" } } },
                { name: "WORDPRESS_URL", value: store.url },
                { name: "WORDPRESS_TITLE", value: store.name },
                { name: "WORDPRESS_ADMIN_USER", value: "shopadmin" },
                { name: "WORDPRESS_ADMIN_EMAIL", value: "shopadmin@example.com" },
                { name: "WORDPRESS_ADMIN_PASSWORD", valueFrom: { secretKeyRef: { name: "shop", key: "WORDPRESS_ADMIN_PASSWORD" } } },
                { name: "WC_CONSUMER_KEY", valueFrom: { secretKeyRef: { name: "shop", key: "WC_CONSUMER_KEY" } } },
                { name: "WC_CONSUMER_SECRET", valueFrom: { secretKeyRef: { name: "shop", key: "WC_CONSUMER_SECRET" } } },
              ],
              resources: config.resources.wordpress,
              volumeMounts: [
                { name: "wordpress", mountPath: "/var/www/html" },
                { name: "scripts", mountPath: "/scripts" },
              ],
            },
          ],
          volumes: [
            { name: "wordpress", persistentVolumeClaim: { claimName: "wordpress" } },
            { name: "scripts", configMap: { name: "wc-bootstrap" } },
          ],
        },
      },
    },
  };

  const apache: K8sObject = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: meta(store, "wordpress-apache", "wordpress"),
    data: {
      "ports.conf": "Listen 8080\n",
      "000-default.conf": "<VirtualHost *:8080>\n  DocumentRoot /var/www/html\n  ErrorLog /proc/self/fd/2\n  CustomLog /proc/self/fd/1 combined\n</VirtualHost>\n",
      "nonroot.conf": "PidFile /tmp/apache2.pid\nMutex posixsem\n",
    },
  };

  return [
    namespace,
    quota,
    limitRange,
    credentials,
    scriptsMap,
    apache,
    mariadbPvc,
    wordpressPvc,
    service(store, "mariadb", "mysql", 3306),
    mariadb,
    service(store, "wordpress", "http", 80),
    wordpress,
    service(store, "woocommerce-mcp", "http", 8080),
    mcp,
    ingress(store, config),
    ...networkPolicies(store, config),
    job,
  ];
}

function pvc(store: StoreRecord, name: string, size: string, storageClass: string): K8sObject {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: meta(store, name),
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: { requests: { storage: size } },
      ...(storageClass ? { storageClassName: storageClass } : {}),
    },
  };
}

function service(store: StoreRecord, name: string, portName: string, port: number): K8sObject {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: meta(store, name),
    spec: {
      selector: { "app.kubernetes.io/name": name },
      ports: [{ name: portName, port, targetPort: portName }],
    },
  };
}

function ingress(store: StoreRecord, config: ProvisionerConfig): K8sObject {
  const host = new URL(store.url).host;
  const secure = store.url.startsWith("https://");
  const annotations: Record<string, string> = { "nginx.ingress.kubernetes.io/proxy-body-size": "20m" };
  if (secure && config.certManager) {
    annotations["cert-manager.io/cluster-issuer"] = "letsencrypt";
    annotations["traefik.ingress.kubernetes.io/router.middlewares"] = "kube-system-redirect-https@kubernetescrd";
  } else if (secure && config.tlsCertResolver) {
    annotations["traefik.ingress.kubernetes.io/router.entrypoints"] = "websecure";
    annotations["traefik.ingress.kubernetes.io/router.tls.certresolver"] = config.tlsCertResolver;
  }
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      ...meta(store, "storefront", "storefront"),
      annotations,
    },
    spec: {
      ingressClassName: config.ingressClass,
      ...(secure ? { tls: [{ hosts: [host], ...(config.certManager ? { secretName: "store-tls" } : {}) }] } : {}),
      rules: [
        {
          host,
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: { service: { name: "wordpress", port: { number: 80 } } },
              },
            ],
          },
        },
      ],
    },
  };
}

function networkPolicies(store: StoreRecord, config: ProvisionerConfig): K8sObject[] {
  const fromGateway = {
    from: [
      {
        namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": config.gatewayNamespace } },
        podSelector: { matchLabels: { "app.kubernetes.io/name": "gateway" } },
      },
    ],
  };
  const fromIngress = {
    from: [
      {
        namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": config.ingressNamespace } },
        podSelector: { matchLabels: config.ingressPodLabels },
      },
    ],
  };
  const dns = {
    to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }],
    ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }],
  };
  return [
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: meta(store, "default-deny"),
      spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"] },
    },
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: meta(store, "allow-dns"),
      spec: { podSelector: {}, policyTypes: ["Egress"], egress: [dns] },
    },
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: meta(store, "mariadb"),
      spec: {
        podSelector: { matchLabels: { "app.kubernetes.io/name": "mariadb" } },
        policyTypes: ["Ingress"],
        ingress: [
          {
            from: [
              { podSelector: { matchLabels: { "app.kubernetes.io/name": "wordpress" } } },
              { podSelector: { matchLabels: { "app.kubernetes.io/name": "wc-bootstrap" } } },
            ],
            ports: [{ protocol: "TCP", port: 3306 }],
          },
        ],
      },
    },
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: meta(store, "wordpress"),
      spec: {
        podSelector: { matchLabels: { "app.kubernetes.io/name": "wordpress" } },
        policyTypes: ["Ingress", "Egress"],
        ingress: [
          { ...fromIngress, ports: [{ protocol: "TCP", port: 8080 }] },
          {
            from: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "woocommerce-mcp" } } }],
            ports: [{ protocol: "TCP", port: 8080 }],
          },
        ],
        egress: [
          dns,
          {
            to: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "mariadb" } } }],
            ports: [{ protocol: "TCP", port: 3306 }],
          },
        ],
      },
    },
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: meta(store, "woocommerce-mcp"),
      spec: {
        podSelector: { matchLabels: { "app.kubernetes.io/name": "woocommerce-mcp" } },
        policyTypes: ["Ingress", "Egress"],
        ingress: [{ ...fromGateway, ports: [{ protocol: "TCP", port: 8080 }] }],
        egress: [
          {
            to: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "wordpress" } } }],
            ports: [{ protocol: "TCP", port: 8080 }],
          },
          {
            to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }],
            ports: [
              { protocol: "UDP", port: 53 },
              { protocol: "TCP", port: 53 },
            ],
          },
        ],
      },
    },
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: meta(store, "wc-bootstrap"),
      spec: {
        podSelector: { matchLabels: { "app.kubernetes.io/name": "wc-bootstrap" } },
        policyTypes: ["Egress"],
        egress: [
          dns,
          {
            to: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "mariadb" } } }],
            ports: [{ protocol: "TCP", port: 3306 }],
          },
          { ports: [{ protocol: "TCP", port: 80 }, { protocol: "TCP", port: 443 }] },
        ],
      },
    },
  ];
}
