import assert from "node:assert/strict";
import test from "node:test";
import { buildToolIndex, searchTools } from "./search.js";
import type { ExposedTool } from "./types.js";

const catalog: ExposedTool[] = [
  { name: "woocommerce__list_orders", description: "[WooCommerce] List orders", inputSchema: {} },
  { name: "woocommerce__create_product", description: "[WooCommerce] Create a product", inputSchema: {} },
  { name: "weather__get_forecast", description: "[Weather] Forecast for a city", inputSchema: {} },
];

test("search returns the closest tools and ignores empty queries", () => {
  const hits = searchTools(catalog, "orders today");
  assert.equal(hits[0]?.name, "woocommerce__list_orders");
  assert.equal(searchTools(catalog, " ").length, 0);
  assert.equal(searchTools(catalog, "forecast mumbai")[0]?.name, "weather__get_forecast");
});

test("the tool index ranks a name token above a description mention", () => {
  const index = buildToolIndex(catalog);
  assert.ok((index.postings.get("orders")?.get("woocommerce__list_orders") ?? 0) >= 3);
  assert.equal(index.postings.has("today"), false);
  assert.equal(index.search("product")[0]?.name, "woocommerce__create_product");
});
