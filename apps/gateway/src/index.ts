import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ZodError } from "zod";
import { credentialKeyFromEnv } from "./crypto.js";
import { migrate, pool, seed, setCredentialKey } from "./db.js";
import { HttpError } from "./errors.js";
import { pollOnce, startPoller } from "./poller.js";
import { api, userFromApiKey } from "./routes.js";
import { callAggregatedTool, listAggregatedTools } from "./tools.js";

function setMcpCors(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

export function createGatewayApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/readyz", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.status(200).json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use("/api", api);

  app.options("/mcp", (_req, res) => {
    setMcpCors(res);
    res.status(204).end();
  });

  app.all("/mcp", async (req, res) => {
    setMcpCors(res);
    const user = await userFromApiKey(req.header("authorization"));
    if (!user) {
      res.status(401).json({ error: "API key is invalid or revoked" });
      return;
    }
    const mcp = new Server(
      { name: "agentdock-gateway", version: "1.0.0" },
      {
        capabilities: { tools: {} },
        instructions: "Tool names are prefixed with the upstream server slug, for example woocommerce__list_orders. A failure from one server does not remove tools from the others.",
      },
    );
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await listAggregatedTools() }));
    mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = request.params.arguments ?? {};
      return (await callAggregatedTool(user, request.params.name, args)) as CallToolResult;
    });
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
      await transport.handleRequest(req, res, req.method === "POST" ? req.body : undefined);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({ error: error instanceof Error ? error.message : "MCP request failed" });
      }
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: error.issues.map((issue) => issue.message).join("; ") });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal error" });
  });

  return app;
}

async function main(): Promise<void> {
  setCredentialKey(credentialKeyFromEnv(process.env.GATEWAY_CREDENTIAL_KEY));
  await migrate();
  await seed();
  await pollOnce();
  startPoller();
  const port = Number(process.env.PORT ?? 8080);
  createGatewayApp().listen(port, "0.0.0.0", () => {
    console.log(`gateway listening on ${port}`);
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
