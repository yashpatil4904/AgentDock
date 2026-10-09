export interface WooConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

interface WooProduct {
  id: number;
  name: string;
  price?: string;
  regular_price?: string;
  status?: string;
  permalink?: string;
  sku?: string;
}

interface WooOrder {
  id: number;
  status: string;
  total?: string;
  currency?: string;
  date_created?: string;
  billing?: { first_name?: string; last_name?: string; email?: string };
  line_items?: Array<{ name?: string; quantity?: number; total?: string }>;
  payment_method?: string;
  payment_method_title?: string;
}

export function wooConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WooConfig {
  const baseUrl = env.WC_BASE_URL?.replace(/\/$/, "");
  const consumerKey = env.WC_CONSUMER_KEY;
  const consumerSecret = env.WC_CONSUMER_SECRET;
  if (!baseUrl || !consumerKey || !consumerSecret) {
    throw new Error("WC_BASE_URL, WC_CONSUMER_KEY, and WC_CONSUMER_SECRET are required");
  }
  return { baseUrl, consumerKey, consumerSecret };
}

export class WooClient {
  constructor(private readonly config: WooConfig) {}

  listProducts(query: { search?: string; perPage?: number; page?: number }): Promise<WooProduct[]> {
    return this.request<WooProduct[]>("GET", "/products", undefined, {
      search: query.search,
      per_page: query.perPage ?? 20,
      page: query.page ?? 1,
      status: "any",
    });
  }

  createProduct(input: { name: string; regularPrice: string; description?: string; sku?: string }): Promise<WooProduct> {
    return this.request<WooProduct>("POST", "/products", {
      name: input.name,
      type: "simple",
      regular_price: input.regularPrice,
      description: input.description ?? "",
      sku: input.sku,
      status: "publish",
      catalog_visibility: "visible",
      manage_stock: false,
      stock_status: "instock",
    });
  }

  listOrders(query: { after?: string; before?: string; status?: string; perPage?: number; page?: number }): Promise<WooOrder[]> {
    return this.request<WooOrder[]>("GET", "/orders", undefined, {
      after: query.after,
      before: query.before,
      status: query.status,
      per_page: query.perPage ?? 20,
      page: query.page ?? 1,
    });
  }

  getOrder(id: number): Promise<WooOrder> {
    return this.request<WooOrder>("GET", `/orders/${id}`);
  }

  updateOrderStatus(id: number, status: string): Promise<WooOrder> {
    return this.request<WooOrder>("PUT", `/orders/${id}`, { status });
  }

  private async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`/wp-json/wc/v3${path}`, this.config.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
      }
    }
    // WooCommerce runs Basic authentication only when it believes the request is HTTPS.
    // These query parameters are the credentials it reads on that path if Apache drops the header.
    url.searchParams.set("consumer_key", this.config.consumerKey);
    url.searchParams.set("consumer_secret", this.config.consumerSecret);
    const token = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString("base64");
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`WooCommerce ${method} ${path} failed (${response.status}): ${text.slice(0, 500)}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }
}

export function summarizeProduct(product: WooProduct) {
  return {
    id: product.id,
    name: product.name,
    price: product.price ?? product.regular_price ?? "",
    status: product.status ?? "",
    sku: product.sku ?? "",
    permalink: product.permalink ?? "",
  };
}

export function summarizeOrder(order: WooOrder) {
  const billing = order.billing ?? {};
  return {
    id: order.id,
    status: order.status,
    total: order.total ?? "",
    currency: order.currency ?? "",
    dateCreated: order.date_created ?? "",
    customer: [billing.first_name, billing.last_name].filter(Boolean).join(" "),
    email: billing.email ?? "",
    paymentMethod: order.payment_method_title ?? order.payment_method ?? "",
    lineItems: (order.line_items ?? []).map((item) => ({
      name: item.name ?? "",
      quantity: item.quantity ?? 0,
      total: item.total ?? "",
    })),
  };
}
