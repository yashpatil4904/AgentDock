import { collectTools } from "./aggregate.js";
import { getServerBySlug, insertAudit, listEnabledInternal, markServer } from "./db.js";
import { parseQualifiedToolName } from "./routing.js";
import type { ToolCallResult, User } from "./types.js";
import { callTimeoutMs, callUpstreamTool, listTimeoutMs, listUpstreamTools, upstreamError } from "./upstream.js";

export async function listAggregatedTools() {
  const servers = await listEnabledInternal();
  const timeout = listTimeoutMs();
  const { tools, failures } = await collectTools(servers, (server) => listUpstreamTools(server, timeout));
  const failed = new Set(failures.map((failure) => failure.slug));
  await Promise.all(
    servers.map(async (server) => {
      const failure = failures.find((item) => item.slug === server.slug);
      if (failure) {
        await markServer(server.id, "unreachable", failure.error, []).catch((error) => console.error("status update failed", error));
        return;
      }
      if (!failed.has(server.slug)) {
        const label = `[${server.name}] `;
        const own = tools.filter((tool) => tool.name.startsWith(`${server.slug}__`)).map((tool) => ({
          name: tool.name.slice(server.slug.length + 2),
          description: tool.description.startsWith(label) ? tool.description.slice(label.length) : tool.description,
        }));
        await markServer(server.id, "connected", null, own).catch((error) => console.error("status update failed", error));
      }
    }),
  );
  return tools;
}

export async function callAggregatedTool(user: User, qualifiedName: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  const started = new Date();
  const parsed = parseQualifiedToolName(qualifiedName);
  const serverSlug = parsed?.slug ?? "unknown";
  const toolName = parsed?.tool ?? qualifiedName;
  const finish = async (success: boolean, error: string | null, result: ToolCallResult) => {
    await insertAudit({
      userId: user.id,
      userEmail: user.email,
      serverSlug,
      tool: toolName,
      startedAt: started,
      durationMs: Date.now() - started.getTime(),
      success,
      error,
    }).catch((auditError) => console.error("audit write failed", auditError));
    return result;
  };

  if (!parsed) {
    const error = `Tool "${qualifiedName}" is missing a server prefix. Expected {server}__{tool}.`;
    return finish(false, error, { content: [{ type: "text", text: error }], isError: true });
  }

  try {
    const server = await getServerBySlug(parsed.slug);
    if (!server) {
      const error = `No MCP server is registered with slug "${parsed.slug}".`;
      return finish(false, error, { content: [{ type: "text", text: error }], isError: true });
    }
    if (!server.enabled) {
      const error = `MCP server "${parsed.slug}" is disabled.`;
      return finish(false, error, { content: [{ type: "text", text: error }], isError: true });
    }
    const result = await callUpstreamTool(server, parsed.tool, args, callTimeoutMs());
    const errorText = result.isError ? result.content.map((block) => block.text).join("\n") : null;
    return finish(!result.isError, errorText, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : upstreamError(parsed.slug, error, callTimeoutMs());
    return finish(false, message, { content: [{ type: "text", text: message }], isError: true });
  }
}
