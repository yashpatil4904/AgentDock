import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createMcpApp, isDirectRun, listen } from "./http.js";
import { summarizeOrder, summarizeProduct, WooClient, wooConfigFromEnv } from "./woocommerce.js";

const orderStatuses = ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"] as const;

function text(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    isError,
  };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "WooCommerce request failed";
  return text({ error: message }, true);
}

export function buildWooServer(client: WooClient = new WooClient(wooConfigFromEnv())): McpServer {
  const server = new McpServer({ name: "woocommerce", version: "1.0.0" });

  server.registerTool(
    "list_products",
    {
      description: "List WooCommerce products. Optional search matches the product name.",
      inputSchema: {
        search: z.string().optional().describe("Case-insensitive product name search"),
        perPage: z.number().int().min(1).max(100).optional().describe("Page size, default 20"),
        page: z.number().int().min(1).optional().describe("1-based page number"),
      },
    },
    async ({ search, perPage, page }) => {
      try {
        const products = await client.listProducts({ search, perPage, page });
        return text(products.map(summarizeProduct));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "create_product",
    {
      description: "Create and publish a simple WooCommerce product. regularPrice is a decimal string such as 19.99.",
      inputSchema: {
        name: z.string().min(1).describe("Product name shown on the storefront"),
        regularPrice: z.string().min(1).describe("Price as a decimal string, without a currency symbol"),
        description: z.string().optional().describe("Optional product description"),
        sku: z.string().optional().describe("Optional unique SKU"),
      },
    },
    async ({ name, regularPrice, description, sku }) => {
      try {
        const product = await client.createProduct({ name, regularPrice, description, sku });
        return text(summarizeProduct(product));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "list_orders",
    {
      description:
        "List WooCommerce orders. For orders placed today, set after to YYYY-MM-DDT00:00:00 and before to the next day at YYYY-MM-DDT00:00:00.",
      inputSchema: {
        after: z.string().optional().describe("ISO-8601 lower bound on date_created, inclusive"),
        before: z.string().optional().describe("ISO-8601 upper bound on date_created, exclusive"),
        status: z.enum(orderStatuses).optional().describe("Filter by order status"),
        perPage: z.number().int().min(1).max(100).optional(),
        page: z.number().int().min(1).optional(),
      },
    },
    async ({ after, before, status, perPage, page }) => {
      try {
        const orders = await client.listOrders({ after, before, status, perPage, page });
        return text(orders.map(summarizeOrder));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_order",
    {
      description: "Get one WooCommerce order by its numeric id.",
      inputSchema: {
        id: z.number().int().positive().describe("WooCommerce order id"),
      },
    },
    async ({ id }) => {
      try {
        return text(summarizeOrder(await client.getOrder(id)));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "update_order_status",
    {
      description: "Change the status of an existing WooCommerce order.",
      inputSchema: {
        id: z.number().int().positive().describe("WooCommerce order id"),
        status: z.enum(orderStatuses).describe("New order status"),
      },
    },
    async ({ id, status }) => {
      try {
        const order = await client.updateOrderStatus(id, status);
        return text({ id: order.id, status: order.status });
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}

export function createWooApp() {
  return createMcpApp(() => buildWooServer());
}

if (isDirectRun(import.meta.url)) {
  wooConfigFromEnv();
  const port = Number(process.env.PORT ?? 8080);
  listen(createWooApp(), port);
}
