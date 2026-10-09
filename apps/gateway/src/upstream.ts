import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { InternalServer, ToolCallResult } from "./types.js";
import type { RawTool } from "./aggregate.js";

export function listTimeoutMs(): number {
  return Number(process.env.LIST_TIMEOUT_MS ?? 3000);
}

export function callTimeoutMs(): number {
  return Number(process.env.CALL_TIMEOUT_MS ?? 20000);
}

export function upstreamError(slug: string, error: unknown, timeoutMs: number): string {
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError" || /timed out|timeout/i.test(error.message))) {
    return `Upstream ${slug} timed out after ${timeoutMs}ms`;
  }
  const message = error instanceof Error ? error.message : "Upstream call failed";
  return `Upstream ${slug} failed: ${message}`;
}

function authHeaders(server: InternalServer): Record<string, string> {
  if (!server.credential || server.authType === "none") return {};
  if (server.authType === "bearer") return { Authorization: `Bearer ${server.credential}` };
  if (!server.authHeader) throw new Error(`Upstream ${server.slug} is missing its header name`);
  return { [server.authHeader]: server.credential };
}

async function withClient<T>(server: InternalServer, timeoutMs: number, run: (client: Client, signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const client = new Client({ name: "agentdock-gateway", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: authHeaders(server) },
  });
  const options = { timeout: timeoutMs, maxTotalTimeout: timeoutMs, signal: controller.signal };
  try {
    await client.connect(transport, options);
    return await run(client, controller.signal);
  } catch (error) {
    throw new Error(upstreamError(server.slug, error, timeoutMs));
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => undefined);
  }
}

export function listUpstreamTools(server: InternalServer, timeoutMs = listTimeoutMs()): Promise<RawTool[]> {
  return withClient(server, timeoutMs, async (client, signal) => {
    const result = await client.listTools(undefined, { timeout: timeoutMs, maxTotalTimeout: timeoutMs, signal });
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: (tool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
    }));
  });
}

export function callUpstreamTool(server: InternalServer, tool: string, args: Record<string, unknown>, timeoutMs = callTimeoutMs()): Promise<ToolCallResult> {
  return withClient(server, timeoutMs, async (client, signal) => {
    const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: timeoutMs, maxTotalTimeout: timeoutMs, signal });
    const content = Array.isArray(result.content)
      ? result.content.map((block) => ({
          type: "text" as const,
          text: block.type === "text" ? block.text : JSON.stringify(block),
        }))
      : [{ type: "text" as const, text: "" }];
    return { content, isError: Boolean(result.isError) };
  });
}
