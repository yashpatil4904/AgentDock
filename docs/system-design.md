# System design and tradeoffs

AgentDock is one Helm chart with two namespaces. `shop` runs MariaDB, WordPress/WooCommerce, and the WooCommerce MCP server. `platform` runs Postgres, the gateway, the dashboard, and two small MCP servers (weather and FX). Ingress publishes only the storefront and the dashboard host. The dashboard host also routes `/api` and `/mcp` to the gateway.

## Why these pieces

The store is stock WordPress plus the WooCommerce plugin. A bootstrap Job installs the plugin, turns on cash on delivery, adds a zero-cost shipping method, and inserts a REST API key. The MCP server we wrote calls the WooCommerce REST API. REST keeps every store call on HTTP, so the gateway's timeout actually bounds it. Shelling into the WordPress pod with WP-CLI would tie tool latency to exec and would be harder to isolate.

Weather (Open-Meteo) and FX (Frankfurter) are the other two upstreams. They are read-only, need no API key, and give the cross-server demo something to call beside orders.

The gateway is both an MCP client and an MCP server. Chat and external clients speak only to the gateway. The gateway opens its own Streamable HTTP client to each upstream and attaches that upstream's stored credential. The caller's API key is checked and then dropped. It is not copied onto the upstream request.

Sessions are stateless. Each `/mcp` request builds a new server and transport with `sessionIdGenerator: undefined` and `enableJsonResponse: true`. A dropped connection does not leave a session, and a second gateway replica would not need sticky sessions. This chart runs one replica. The property is there so a later replica does not require a different protocol.

## Tool aggregation, routing, and failures

`tools/list` asks every enabled server at once, with a 3 second timeout each (`LIST_TIMEOUT_MS`). `collectTools` keeps the tools that came back and records the rest as failures. A timeout or connection error does not fail the list.

Names are `{slug}__{tool}`. `woocommerce__list_orders` and another server's `list_orders` stay distinct. The gateway splits on the first `__`, checks that the server exists and is enabled, and forwards the original tool name. Slugs cannot contain `__`.

`tools/call` uses a 20 second timeout (`CALL_TIMEOUT_MS`). Failure comes back as a tool error (`isError: true`) with text such as `Upstream weather timed out after 3000ms` or `MCP server "weather" is disabled.` The gateway process stays up, and other servers are still listed and callable.

A poller refreshes status every 10 seconds. The dashboard shows Connected, Unreachable, or Disabled, plus the last error string. Disabled servers are removed from the live tool list immediately. A dead pod is marked Unreachable on the next poll or when someone lists tools, and its cached tools are cleared.

## Credentials

Gateway API keys are random `urk_...` tokens. Postgres stores SHA-256 only, plus a short prefix for the UI. The full token is returned once. Revocation sets `revoked_at`. The next request with that token is HTTP 401.

Upstream URL credentials are AES-256-GCM ciphertext in Postgres. The 32-byte key is `GATEWAY_CREDENTIAL_KEY` from a Kubernetes Secret. List and edit APIs return `hasCredential`, never the secret. WooCommerce consumer keys, the database passwords, the admin password, and the Groq key are Kubernetes Secrets mounted into the specific container that needs them.

## What changes for production

`values-prod.yaml` is the same chart pointed at k3s:

- Ingress class `traefik` in `kube-system` instead of `ingress-nginx`.
- Hosts and `wordpress.url` / `gateway.publicUrl` become the real DNS names, with `cookieSecure: true` so the session cookie is HTTPS-only.
- Storage class stays `local-path`, which k3s already installs. Kind has to install that provisioner first.
- Images are registry tags (or tags imported with `k3s ctr images import`) instead of `:local` images loaded into Kind.
- Secrets stay in a file outside git, passed with `-f`. Nothing secret is in the image or the chart defaults.

## Extra stores

The platform shop in the `shop` namespace stays the Helm-managed store. Its tools keep the `woocommerce__` prefix. Stores created in the dashboard are rows in Postgres (`provisioning`, `ready`, `failed`, or `deleting`). A separate provisioner reconciles those rows through the Kubernetes API. It does not shell out to Helm. Each store gets a `store-<slug>` namespace with its own Secret, MariaDB and WordPress volumes, WooCommerce bootstrap Job, MCP Deployment, Ingress, ResourceQuota, LimitRange, and NetworkPolicies. When the bootstrap Job has succeeded and the MCP server is ready, the provisioner inserts an `mcp_servers` row. Tool names are `{slug}__{tool}`, and the description is prefixed with the store name.

Create is an insert. The work happens in the reconciler, so several stores proceed at once, and a restart continues from the row. Steps create a resource only when it is missing, so a retry does not rotate the database password or duplicate the namespace. A failed bootstrap Job is deleted and created again. After 15 minutes the row becomes `failed` with the step it was stuck on. Retry resets the clock and keeps the namespace. Delete drops the MCP registration first, then the namespace, which takes the volumes and Secrets with it. The row is removed only after the namespace is gone.

The provisioner holds a Postgres advisory lock for each pass, so a second replica would wait instead of creating the same Job twice. This chart runs one replica.

## Upgrade and rollback

Application images and the chart version move together.

```bash
helm upgrade agentdock deploy/helm/urumi -n agentdock -f deploy/helm/urumi/values-prod.yaml -f /etc/agentdock/secrets.yaml
helm history agentdock -n agentdock
helm rollback agentdock <revision> -n agentdock
```

Database and WordPress volumes are PersistentVolumeClaims, so a rollback of the Deployment does not wipe orders. The WooCommerce bootstrap Job is a post-install/post-upgrade hook and is idempotent: it skips install steps that already ran. Take a database dump before a WordPress or WooCommerce major upgrade. Rollback of that pair is the previous image tag plus `helm rollback`, not a down-migration of the WordPress schema.
