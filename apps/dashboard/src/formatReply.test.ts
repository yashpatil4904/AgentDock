import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReply } from "./formatReply.ts";

test("a one-line order table becomes a markdown table", () => {
  const raw = "**Combined order summary (all time, up to 2026-10-11)** | Store | Orders | Revenue (USD) | |-------|--------|---------------| | WooCommerce (main store) | 1 | $19.00 | | West Shop | 1 | $57.00 | | **Total** | **2** | **$76.00** | So far you have received **2 orders** across all of your shops.";
  const formatted = formatReply(raw);
  assert.match(formatted, /^\*\*Combined order summary/);
  assert.match(formatted, /\n\| Store \| Orders \| Revenue \(USD\) \|\n\|-------\|/);
  assert.match(formatted, /\n\| WooCommerce \(main store\) \| 1 \| \$19\.00 \|\n/);
  assert.match(formatted, /\n\nSo far you have received/);
});

test("a table that already has line breaks stays a table", () => {
  const raw = "| Store | Orders |\n|-------|--------|\n| East | 1 |";
  assert.equal(formatReply(raw), raw);
});

test("a reply without a table is left unchanged", () => {
  assert.equal(formatReply("Created **Running Shoes** for 49.00."), "Created **Running Shoes** for 49.00.");
});
