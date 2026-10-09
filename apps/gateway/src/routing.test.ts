import assert from "node:assert/strict";
import { test } from "node:test";
import { collectTools } from "./aggregate.js";
import { parseQualifiedToolName, qualifyToolName, slugFromName } from "./routing.js";
import { assertUpstreamUrl } from "./url-guard.js";

test("prefixes keep identical tool names distinct and reversible", () => {
  assert.equal(qualifyToolName("woocommerce", "list_orders"), "woocommerce__list_orders");
  assert.equal(qualifyToolName("inventory", "list_orders"), "inventory__list_orders");
  assert.deepEqual(parseQualifiedToolName("woocommerce__list_orders"), { slug: "woocommerce", tool: "list_orders" });
  assert.deepEqual(parseQualifiedToolName("fx__convert"), { slug: "fx", tool: "convert" });
  assert.equal(parseQualifiedToolName("list_orders"), null);
});

test("a dead upstream is omitted and the other server's tools remain", async () => {
  const result = await collectTools(
    [
      { slug: "woocommerce", name: "WooCommerce" },
      { slug: "weather", name: "Weather" },
    ],
    async (server) => {
      if (server.slug === "weather") throw new Error("connect ECONNREFUSED");
      return [{ name: "list_orders", description: "List orders", inputSchema: { type: "object" } }];
    },
  );
  assert.deepEqual(result.tools.map((tool) => tool.name), ["woocommerce__list_orders"]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.slug, "weather");
  assert.match(result.tools[0]?.description ?? "", /WooCommerce/);
});

test("slug derivation is stable and metadata addresses are refused", () => {
  assert.equal(slugFromName("WooCommerce MCP"), "woocommerce_mcp");
  assert.equal(assertUpstreamUrl("http://woocommerce-mcp.shop.svc.cluster.local:8080/mcp").hostname, "woocommerce-mcp.shop.svc.cluster.local");
  assert.throws(() => assertUpstreamUrl("http://169.254.169.254/latest"), /metadata/);
  assert.throws(() => assertUpstreamUrl("file:///etc/passwd"), /http or https/);
});
