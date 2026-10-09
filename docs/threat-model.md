# Threat model

This is one team sharing a store. It is not a multi-tenant host. The bonus multi-store isolation work is not in this build.

## Shared upstream credentials

The WooCommerce consumer key lives in a Secret on the MCP server and, for servers an admin adds later, as encrypted ciphertext in Postgres. A member never receives it. What they can do is call the tools the gateway exposes: list and create products, list and get orders, change order status, plus the weather and FX tools. That is the store's capability, exercised as themselves, with an audit row. They cannot read the key out of the dashboard, the MCP `tools/list` payload, or a tool result. Stealing a member API key lets someone act as that member until the key is revoked. It does not reveal the WooCommerce key, so rotating the member key does not require rotating the store key.

## Why client tokens are not forwarded

The gateway authenticates the caller, then opens a separate client to the upstream. The upstream request carries only the credential stored for that server (none, a bearer token, or one named header). The member's `urk_...` key and the dashboard session cookie are not copied. An upstream therefore cannot replay a member key against the gateway, and a malicious upstream cannot collect gateway credentials from ordinary tool calls.

## Untrusted upstreams

An admin can register any Streamable HTTP URL. That server chooses its tool names and descriptions. After prefixing, those descriptions are handed to Groq and to external clients. A hostile description can try to talk the model into calling a tool, hiding data in the arguments, or preferring that server. The gateway does not treat tool text as instructions to itself. It still forwards the text, because that is how MCP tool discovery works.

Practical bounds in this build:

- Only an admin can add, edit, disable, or remove a server.
- Tool calls are attributed in the audit log.
- The gateway will not send the caller's token or another server's credential to the new upstream.
- Cloud metadata addresses (`169.254.169.254`, `metadata.google.internal`) are rejected. Cluster-internal hosts are allowed on purpose, because the WooCommerce MCP Service is only reachable that way. An admin can still register an internal URL the gateway can route to. That is an admin-level action, not a member action.
- Disabling the server removes its tools from the live list. Deleting it removes the row and the ciphertext.

A compromised upstream can return misleading tool results. The audit log shows that the call happened. It cannot show that the result was true.

## What one member can do to another

Members share the same upstream tools, so a member can create products or change orders that another member can see. They cannot:

- Read or change upstream credentials.
- Register or disable servers.
- Invite users or issue keys for someone else.
- See another member's API key. Keys are stored hashed, and the plaintext is shown once to the person who created it.
- Read another member's audit rows. Admins see every row. Members see their own.

They also cannot reach the WooCommerce MCP, weather, or FX Services from outside the cluster. Those Services are ClusterIP, and NetworkPolicies accept connections only from gateway pods. MariaDB accepts only WordPress and the bootstrap Job. Postgres accepts only the gateway.

The dashboard session is an HttpOnly cookie, `SameSite=Lax`. It is not a token the chat model is given. The chat path uses the logged-in user id on the server when it writes the audit log.

## What this does not claim

Containers for our Node services run as non-root. The official WordPress and MariaDB images still start with their own users. There is no default-deny policy on the whole cluster, no OAuth, and no per-tool permission split between admin and member. A member who can call tools can create products and change order status. NetworkPolicies do not stop the gateway itself from being induced to call a malicious upstream an admin registered.
