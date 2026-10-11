const SEPARATOR = "__";

export function qualifyToolName(slug: string, tool: string): string {
  return `${slug}${SEPARATOR}${tool}`;
}

export function parseQualifiedToolName(qualified: string): { slug: string; tool: string } | null {
  const index = qualified.indexOf(SEPARATOR);
  if (index <= 0 || index === qualified.length - SEPARATOR.length) return null;
  return {
    slug: qualified.slice(0, index),
    tool: qualified.slice(index + SEPARATOR.length),
  };
}

export function assertSlug(slug: string): void {
  if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Slug must start with a letter and use lowercase letters, digits, and single underscores");
  }
}

const RESERVED_STORE_SLUGS = new Set(["woocommerce", "weather", "fx", "shop", "app", "store", "platform", "default", "kube", "kubernetes"]);

export function storeIdentity(slug: string, hostSuffix: string, scheme: string): { namespace: string; host: string; url: string } {
  assertSlug(slug);
  if (RESERVED_STORE_SLUGS.has(slug)) {
    throw new Error(`The name "${slug}" is reserved`);
  }
  const label = slug.replace(/_/g, "-");
  if (label === "shop" || label === "app" || label.length > 50) {
    throw new Error(`The name "${slug}" cannot be used as a store address`);
  }
  const namespace = `store-${label}`;
  const host = `${label}.${hostSuffix}`;
  return { namespace, host, url: `${scheme}://${host}` };
}

export function slugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 40)
    .replace(/_+$/g, "");
  assertSlug(slug);
  return slug;
}
