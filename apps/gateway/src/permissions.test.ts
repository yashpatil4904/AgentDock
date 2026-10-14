import assert from "node:assert/strict";
import test from "node:test";
import { isWriteTool, toolAllowed } from "./permissions.js";

test("members can read orders and are blocked from writes", () => {
  assert.equal(toolAllowed("member", "woocommerce__list_orders"), true);
  assert.equal(toolAllowed("member", "woocommerce__get_order"), true);
  assert.equal(toolAllowed("member", "weather__get_forecast"), true);
  assert.equal(isWriteTool("woocommerce__create_product"), true);
  assert.equal(toolAllowed("member", "woocommerce__create_product"), false);
  assert.equal(toolAllowed("member", "woocommerce__update_order_status"), false);
  assert.equal(toolAllowed("member", "shop__delete_product"), false);
  assert.equal(toolAllowed("admin", "woocommerce__create_product"), true);
});
