import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { configFromEnv } from "./config.js";
import { activeStores, liveStores, pool } from "./db.js";
import { Cluster } from "./k8s.js";
import { reconcileHostedServers } from "./hosted.js";
import { reconcileStore } from "./reconcile.js";
import { storeObjects, type StoreSecret } from "./resources.js";

const tickIntervalMs = 5_000;
let lastTick = Date.now();

async function tick(cluster: Cluster, scripts: { sh: string; php: string; look: string }): Promise<void> {
  const config = configFromEnv();
  const client = await pool.connect();
  try {
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(84215045) AS locked");
    if (!lock.rows[0]?.locked) return;
    try {
      await reconcileHostedServers(cluster, config);
      await syncRunningStores(cluster, config, scripts);
      const stores = await activeStores();
      await Promise.all(stores.map(async (store) => {
        try {
          await reconcileStore(store, cluster, config, scripts);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Provisioning step failed";
          console.error(`store ${store.slug}: ${message}`);
          await pool.query(
            "UPDATE stores SET detail = $2, updated_at = now() WHERE id = $1 AND status IN ('provisioning', 'deleting')",
            [store.id, message.slice(0, 500)],
          ).catch((updateError: unknown) => console.error(updateError));
        }
      }));
    } finally {
      await client.query("SELECT pg_advisory_unlock(84215045)");
    }
  } finally {
    client.release();
  }
  lastTick = Date.now();
}

const unusedSecret: StoreSecret = {
  rootPassword: "unused",
  dbPassword: "unused",
  adminPassword: "unused",
  consumerKey: "unused",
  consumerSecret: "unused",
};

async function syncRunningStores(cluster: Cluster, config: ReturnType<typeof configFromEnv>, scripts: { sh: string; php: string; look: string }): Promise<void> {
  const stores = (await liveStores()).filter((store) => store.namespace.startsWith("store-"));
  await Promise.all(stores.map(async (store) => {
    try {
      const objects = storeObjects(store, config, unusedSecret, scripts);
      for (const obj of objects) {
        const trackDeployment = obj.kind === "Deployment" && (obj.metadata.name === "wordpress" || obj.metadata.name === "mariadb");
        const trackConfig = obj.kind === "ConfigMap" && obj.metadata.name === "wordpress-apache";
        if (obj.kind !== "NetworkPolicy" && obj.kind !== "Ingress" && !trackDeployment && !trackConfig) continue;
        await cluster.replace(obj);
      }
    } catch (error) {
      console.error(`store ${store.slug}: ${error instanceof Error ? error.message : "policy update failed"}`);
    }
  }));
}

async function waitForStores(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1 FROM stores LIMIT 1");
      return;
    } catch {
      console.error("waiting for the gateway to create the stores table");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await waitForStores();
  const config = configFromEnv();
  const scripts = {
    sh: readFileSync(path.join(config.scriptsDir, "wc-setup.sh"), "utf8"),
    php: readFileSync(path.join(config.scriptsDir, "wc-setup.php"), "utf8"),
    look: readFileSync(path.join(config.scriptsDir, "agentdock-look.php"), "utf8"),
  };
  const cluster = new Cluster();
  lastTick = Date.now();
  createServer((_req, res) => {
    const fresh = Date.now() - lastTick < tickIntervalMs * 4;
    res.writeHead(fresh ? 200 : 500);
    res.end(fresh ? "ok" : "stale");
  }).listen(8080, "0.0.0.0");

  const run = () => {
    tick(cluster, scripts).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
    });
  };
  run();
  setInterval(run, tickIntervalMs);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
