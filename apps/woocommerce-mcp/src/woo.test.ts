import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { createMcpApp, listen } from "./http.js";
import { buildWooServer } from "./index.js";
import { WooClient } from "./woocommerce.js";

const key = "ck_test";
const secret = "cs_test";
let woo: Server;
let mcp: Server;
let wooPort = 0;
let mcpPort = 0;
const created: unknown[] = [];
const updates: unknown[] = [];

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

before(async () => {
  woo = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const auth = req.headers.authorization ?? "";
    const expected = `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
    if (auth !== expected) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    if (req.method === "GET" && url.pathname === "/wp-json/wc/v3/products") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([{ id: 7, name: "Classic Tee", price: "19.00", status: "publish", permalink: "http://shop/tee", sku: "classic-tee" }]));
      return;
    }
    if (req.method === "POST" && url.pathname === "/wp-json/wc/v3/products") {
      const body = JSON.parse(await readBody(req)) as { name: string; regular_price: string };
      created.push(body);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: 8, name: body.name, price: body.regular_price, status: "publish", permalink: "http://shop/new" }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/wp-json/wc/v3/orders" && url.searchParams.has("after")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([{
        id: 100,
        status: "processing",
        total: "19.00",
        currency: "USD",
        date_created: "2026-10-09T12:00:00",
        billing: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
        line_items: [{ name: "Classic Tee", quantity: 1, total: "19.00" }],
        payment_method_title: "Cash on delivery",
      }]));
      return;
    }
    if (req.method === "GET" && url.pathname === "/wp-json/wc/v3/orders/100") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: 100, status: "processing", total: "19.00", currency: "USD", line_items: [] }));
      return;
    }
    if (req.method === "PUT" && url.pathname === "/wp-json/wc/v3/orders/100") {
      const body = JSON.parse(await readBody(req)) as { status: string };
      updates.push(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: 100, status: body.status }));
      return;
    }
    res.writeHead(404).end("missing");
  });
  await new Promise<void>((resolve) => woo.listen(0, "127.0.0.1", resolve));
  wooPort = (woo.address() as AddressInfo).port;

  const client = new WooClient({ baseUrl: `http://127.0.0.1:${wooPort}`, consumerKey: key, consumerSecret: secret });
  const app = createMcpApp(() => buildWooServer(client));
  mcp = listen(app, 0);
  await new Promise<void>((resolve) => mcp.once("listening", resolve));
  mcpPort = (mcp.address() as AddressInfo).port;
});

after(async () => {
  await new Promise<void>((resolve) => mcp.close(() => resolve()));
  await new Promise<void>((resolve) => woo.close(() => resolve()));
});

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`));
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test("lists the five WooCommerce tools over Streamable HTTP", async () => {
  const names = await withClient(async (client) => (await client.listTools()).tools.map((tool) => tool.name).sort());
  assert.deepEqual(names, ["create_product", "get_order", "list_orders", "list_products", "update_order_status"]);
});

test("create, list, get, and update go through the REST client", async () => {
  await withClient(async (client) => {
    const createdResult = await client.callTool({ name: "create_product", arguments: { name: "Running Shoes", regularPrice: "49.00" } });
    assert.equal(createdResult.isError, false);
    assert.deepEqual(created[0], {
      name: "Running Shoes",
      type: "simple",
      regular_price: "49.00",
      description: "",
      status: "publish",
      catalog_visibility: "visible",
      manage_stock: false,
      stock_status: "instock",
    });

    const orders = await client.callTool({ name: "list_orders", arguments: { after: "2026-10-09T00:00:00" } });
    const orderText = JSON.stringify(orders.content);
    assert.match(orderText, /Classic Tee/);

    const one = await client.callTool({ name: "get_order", arguments: { id: 100 } });
    assert.match(JSON.stringify(one.content), /100/);

    const updated = await client.callTool({ name: "update_order_status", arguments: { id: 100, status: "completed" } });
    assert.match(JSON.stringify(updated.content), /completed/);
    assert.deepEqual(updates[0], { status: "completed" });
  });
});
