const blockedHosts = new Set(["169.254.169.254", "metadata.google.internal", "metadata.google.com"]);

/**
 * Cluster-internal hosts stay allowed: the WooCommerce MCP Service is only
 * reachable inside the cluster. Cloud metadata addresses are refused so an
 * admin cannot point a server at the instance identity endpoint.
 */
export function assertUpstreamUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL is not valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }
  const host = url.hostname.toLowerCase();
  if (blockedHosts.has(host) || host.endsWith(".metadata.google.internal")) {
    throw new Error("Refusing a cloud metadata address");
  }
  return url;
}
