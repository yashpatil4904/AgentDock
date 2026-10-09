import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express } from "express";
import type { Server } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Stateless Streamable HTTP. A new server and transport are created per request
 * so a dropped connection does not leave a session behind, and one slow client
 * cannot pin a shared transport.
 */
export function createMcpApp(buildServer: () => McpServer): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.options("/mcp", (_req, res) => {
    setMcpCors(res);
    res.status(204).end();
  });

  app.all("/mcp", async (req, res) => {
    setMcpCors(res);
    const mcp = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      const body = req.method === "POST" ? req.body : undefined;
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: error instanceof Error ? error.message : "MCP request failed" },
          id: null,
        });
      }
    }
  });

  return app;
}

function setMcpCors(res: express.Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

export function listen(app: Express, port: number): Server {
  return app.listen(port, "0.0.0.0", () => {
    console.log(`listening on ${port}`);
  });
}

export function isDirectRun(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(path.resolve(entry)).href;
}
