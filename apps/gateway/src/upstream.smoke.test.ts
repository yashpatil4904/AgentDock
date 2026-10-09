import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const children: ChildProcess[] = [];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function start(entry: string, port: number): Promise<void> {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`server did not start: ${entry}`);
}

after(() => {
  for (const child of children) child.kill();
});

test("weather and fx answer through Streamable HTTP", async () => {
  const weatherPort = await freePort();
  const fxPort = await freePort();
  await start(path.resolve(here, "../../weather-mcp/dist/index.js"), weatherPort);
  await start(path.resolve(here, "../../fx-mcp/dist/index.js"), fxPort);

  const weather = new Client({ name: "smoke", version: "1.0.0" });
  await weather.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${weatherPort}/mcp`)));
  const weatherTools = await weather.listTools();
  assert.deepEqual(weatherTools.tools.map((tool) => tool.name), ["get_forecast"]);
  const forecast = await weather.callTool({ name: "get_forecast", arguments: { location: "London" } });
  assert.equal(forecast.isError, false);
  assert.match(JSON.stringify(forecast.content), /London/);
  await weather.close();

  const fx = new Client({ name: "smoke", version: "1.0.0" });
  await fx.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${fxPort}/mcp`)));
  const converted = await fx.callTool({ name: "convert", arguments: { amount: 10, from: "USD", to: "EUR" } });
  assert.equal(converted.isError, false);
  assert.match(JSON.stringify(converted.content), /converted/);
  await fx.close();
});
