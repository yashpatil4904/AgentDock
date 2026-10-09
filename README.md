# AgentDock

WooCommerce on Kubernetes, with a team MCP gateway in front of it. An admin registers MCP servers once. Every teammate uses them through one gateway URL, or through the chat agent in the dashboard.

The WooCommerce MCP server in this repo is ours. It speaks Streamable HTTP and calls the store with the WooCommerce REST API. Weather and FX are two more upstreams so the gateway has three servers to aggregate.

Bonus multi-store provisioning is not implemented. A working core is the goal.

## What runs where

| Namespace | Workload | Reachable from |
| --- | --- | --- |
| `shop` | MariaDB (PVC) | WordPress and the bootstrap Job |
| `shop` | WordPress + WooCommerce (PVC) | Ingress, and the WooCommerce MCP server |
| `shop` | WooCommerce MCP server | Gateway pods only |
| `platform` | Postgres (PVC) | Gateway pods only |
| `platform` | Gateway | Ingress `/api` and `/mcp` |
| `platform` | Dashboard | Ingress `/` |
| `platform` | Weather MCP, FX MCP | Gateway pods only |

NetworkPolicies enforce the "only the gateway" rows. Everything else is ClusterIP with no Ingress. Public URLs are the storefront and the dashboard.

Local domains use [localtest.me](https://localtest.me), which resolves `*.localtest.me` to `127.0.0.1`. No hosts-file entry is required when that DNS name resolves. If you are offline, add:

```
127.0.0.1 shop.localtest.me app.localtest.me
```

Kind maps host ports 80 and 443 to the ingress controller, so the URLs are `http://shop.localtest.me` and `http://app.localtest.me`.

## Local setup

Install Docker Desktop, [kind](https://kind.sigs.k8s.io/), kubectl, Helm 3, and Node 22 or newer. Port 80 on the host must be free.

```powershell
.\deploy\scripts\up-local.ps1
```

On bash:

```bash
bash deploy/scripts/up-local.sh
```

The script creates a Kind cluster named `agentdock`, installs the local-path provisioner and ingress-nginx, builds the five app images, loads them into Kind, generates `deploy/helm/urumi/secrets.local.yaml` if it is missing, and installs the chart. The same chart is `deploy/helm/urumi`, with `values-local.yaml` for this cluster.

Paste a Groq API key into `secrets.groqApiKey` in that file before you use chat, then upgrade:

```powershell
helm upgrade agentdock deploy/helm/urumi -n agentdock --timeout 20m -f deploy/helm/urumi/values-local.yaml -f deploy/helm/urumi/secrets.local.yaml
```

`secrets.local.yaml` is gitignored. `secrets.example.yaml` shows the shape. Passwords are generated. Read them with:

```powershell
kubectl -n platform get secret gateway -o jsonpath="{.data.ADMIN_PASSWORD}" | %{ [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }
kubectl -n shop get secret shop -o jsonpath="{.data.WORDPRESS_ADMIN_PASSWORD}" | %{ [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }
```

Gateway login is `admin@agentdock.local` plus `ADMIN_PASSWORD`. WordPress admin user is `shopadmin` plus `WORDPRESS_ADMIN_PASSWORD`.

The bootstrap Job installs WooCommerce, enables cash on delivery, and creates a sample product named Classic Tee. Watch it with:

```powershell
kubectl -n shop logs job/wc-bootstrap
```

## Place an order

1. Open http://shop.localtest.me
2. Open Classic Tee, add it to the cart, and check out.
3. Pay with cash on delivery. Guest checkout is enabled.
4. Confirm the order in WordPress admin at http://shop.localtest.me/wp-admin

## Chat agent

Sign in to http://app.localtest.me as the admin (user A). Open Chat.

Ask it to create a product with a name and a price, for example: "Create a product called Running Shoes for 49.00". The product should appear on the storefront. Place an order for it by hand, then ask: "What orders came in today?" The agent calls `woocommerce__list_orders`. The tool names it used are shown on the reply, and the audit log attributes the calls to that user.

A prompt that needs two upstreams: "What is today's order total in EUR?" That uses WooCommerce and `fx__convert`.

## External MCP client

Invite a second user on Members (role member). Sign in as that user and create an API key. The full key is shown once.

In Cursor, Claude Code, or MCP Inspector, add one server:

- URL: `http://app.localtest.me/mcp`
- Header: `Authorization: Bearer urk_...`

`tools/list` returns every enabled server, with names prefixed by the server slug (`woocommerce__list_orders`, `weather__get_forecast`, `fx__convert`). Ask the same orders question, then a prompt that needs two servers.

There is no setting for the WooCommerce, weather, or FX URLs in the client. Those credentials stay on the gateway.

## Revoke, disable, kill

- Revoke user B's key on API keys. The next MCP call returns 401.
- Disable Weather. Its tools disappear from Chat and from `tools/list`. WooCommerce and FX still answer.
- `kubectl -n platform delete pod -l app.kubernetes.io/name=weather-mcp`. Within about 10 seconds the dashboard shows Weather as unreachable, with the error string. The other servers keep working. Click Refresh status if you do not want to wait for the poller.
- Audit log lists who called which server and tool, when, how long, and whether it succeeded.

## Production-like VPS (k3s)

k3s already provides Traefik and the `local-path` StorageClass. Do not install ingress-nginx there.

1. Install k3s and Helm on the VPS.
2. Build the images and either push them to a registry or import them:

```bash
docker save agentdock/gateway:1.0.0 | sudo k3s ctr images import -
```

Use the image names in `deploy/helm/urumi/values-prod.yaml`, or change that file. Also set the real shop and app hostnames. Point DNS at the VPS. For TLS, put cert-manager or Traefik certificates in front of the same Ingress hosts. The chart's `gateway.cookieSecure` is already `true` in the prod values, and `wordpress.url` is `https://`.

3. Copy `secrets.example.yaml` to `/etc/agentdock/secrets.yaml` on the server and fill it in. Do not commit it.
4. Install the same chart:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
helm upgrade --install agentdock deploy/helm/urumi \
  --namespace agentdock --create-namespace --timeout 20m \
  -f deploy/helm/urumi/values-prod.yaml \
  -f /etc/agentdock/secrets.yaml
```

What changed is values only: ingress class and controller namespace, DNS hosts, the public URLs, the secure cookie flag, image names, and the secrets file. Storage class `local-path` matches what k3s installs. Kind installs that provisioner in the local script because Kind does not ship one.

Upgrade and roll back with Helm. Volumes are claims, so a rollback does not delete the store.

```bash
helm upgrade agentdock deploy/helm/urumi -n agentdock --timeout 20m \
  -f deploy/helm/urumi/values-prod.yaml -f /etc/agentdock/secrets.yaml
helm history agentdock -n agentdock
helm rollback agentdock <revision> -n agentdock
```

The WooCommerce bootstrap Job is an idempotent post-upgrade hook. It will not create a second API key or a second sample product. Dump the database before a WordPress or WooCommerce major upgrade. Rolling back the chart restores the previous images. It does not reverse a WordPress schema migration.

## How the WooCommerce MCP server talks to the store

REST API v3, HTTP Basic with the consumer key from the Secret. The bootstrap Job inserts the matching hashed key into `wp_woocommerce_api_keys`. REST is used instead of WP-CLI so a slow store call is an HTTP timeout the gateway can enforce, and so the MCP server never execs into the WordPress container.

Tool names on that server, before the gateway prefixes them: `list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status`.

## Layout

- `apps/woocommerce-mcp` — store tools
- `apps/weather-mcp`, `apps/fx-mcp` — the other two upstreams
- `apps/gateway` — MCP endpoint, team API, audit, Groq chat loop
- `apps/dashboard` — React UI
- `deploy/helm/urumi` — chart, `values-local.yaml`, `values-prod.yaml`
- `docs/system-design.md` — aggregation, routing, failures, production values
- `docs/threat-model.md` — credentials, untrusted servers, members

## Tests without a cluster

```powershell
npm test
```

That builds the services and checks the WooCommerce tool path against a fake REST server, tool-name prefixing, a dead upstream being dropped from the list, credential encryption, and live Streamable HTTP calls to weather and FX.

## Not in this submission

Multi-store provisioning, OAuth, per-tool role permissions, hosted MCP servers, and a live VPS deploy. `values-prod.yaml` and the k3s section above are the production path for the same chart.
