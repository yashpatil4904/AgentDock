import { qualifyToolName } from "./routing.js";
import type { ExposedTool } from "./types.js";

export interface ToolSource {
  slug: string;
  name: string;
}

export interface RawTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export function normalizeSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
  const copy = { ...(schema as Record<string, unknown>) };
  delete copy.$schema;
  if (copy.type !== "object") copy.type = "object";
  if (!copy.properties) copy.properties = {};
  return copy;
}

export function exposeTool(server: ToolSource, tool: RawTool): ExposedTool {
  return {
    name: qualifyToolName(server.slug, tool.name),
    description: `[${server.name}] ${tool.description ?? tool.name}`,
    inputSchema: normalizeSchema(tool.inputSchema),
  };
}

/**
 * Lists every server in parallel. A timeout or connection error drops that
 * server's tools and records a failure. It does not reject the whole list.
 */
export async function collectTools<T extends ToolSource>(
  servers: T[],
  listTools: (server: T) => Promise<RawTool[]>,
): Promise<{ tools: ExposedTool[]; failures: Array<{ slug: string; error: string }> }> {
  const settled = await Promise.all(
    servers.map(async (server) => {
      try {
        const tools = await listTools(server);
        return { server, tools, error: null as string | null };
      } catch (error) {
        return { server, tools: [] as RawTool[], error: error instanceof Error ? error.message : "Upstream call failed" };
      }
    }),
  );
  const tools: ExposedTool[] = [];
  const failures: Array<{ slug: string; error: string }> = [];
  for (const item of settled) {
    if (item.error) failures.push({ slug: item.server.slug, error: item.error });
    else tools.push(...item.tools.map((tool) => exposeTool(item.server, tool)));
  }
  return { tools, failures };
}
