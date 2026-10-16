import assert from "node:assert/strict";
import test from "node:test";
import { toolAllowed } from "./permissions.js";

test("members can call the allow list and nothing else", () => {
  assert.equal(toolAllowed("member", "woocommerce__list_orders"), true);
  assert.equal(toolAllowed("member", "woocommerce__get_order"), true);
  assert.equal(toolAllowed("member", "east__list_products"), true);
  assert.equal(toolAllowed("member", "weather__get_forecast"), true);
  assert.equal(toolAllowed("member", "fx__convert"), true);
  assert.equal(toolAllowed("member", "woocommerce__create_product"), false);
  assert.equal(toolAllowed("member", "woocommerce__update_order_status"), false);
  assert.equal(toolAllowed("member", "shop__delete_product"), false);
  assert.equal(toolAllowed("member", "woocommerce__make_product"), false);
  assert.equal(toolAllowed("admin", "woocommerce__make_product"), true);
  assert.equal(toolAllowed("admin", "woocommerce__create_product"), true);
});
