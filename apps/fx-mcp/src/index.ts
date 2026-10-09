import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createMcpApp, isDirectRun, listen } from "./http.js";

const currency = z.string().regex(/^[A-Za-z]{3}$/, "Use a 3-letter ISO currency code");

interface FrankfurterLatest {
  base: string;
  date: string;
  rates: Record<string, number>;
}

function text(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    isError,
  };
}

async function latestRate(from: string, to: string): Promise<{ rate: number; date: string; from: string; to: string }> {
  const url = new URL("https://api.frankfurter.app/latest");
  url.searchParams.set("from", from.toUpperCase());
  url.searchParams.set("to", to.toUpperCase());
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok) throw new Error(`Frankfurter failed (${response.status}): ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body) as FrankfurterLatest;
  const rate = parsed.rates[to.toUpperCase()];
  if (typeof rate !== "number") throw new Error(`No rate from ${from} to ${to}`);
  return { rate, date: parsed.date, from: parsed.base, to: to.toUpperCase() };
}

export function buildFxServer(): McpServer {
  const server = new McpServer({ name: "fx", version: "1.0.0" });

  server.registerTool(
    "get_rate",
    {
      description: "Get the latest foreign-exchange rate between two ISO currency codes, using Frankfurter (ECB).",
      inputSchema: {
        from: currency.describe("Source currency, for example USD"),
        to: currency.describe("Target currency, for example EUR"),
      },
    },
    async ({ from, to }) => {
      try {
        return text(await latestRate(from, to));
      } catch (error) {
        return text({ error: error instanceof Error ? error.message : "Rate lookup failed" }, true);
      }
    },
  );

  server.registerTool(
    "convert",
    {
      description: "Convert an amount from one ISO currency to another using the latest Frankfurter rate.",
      inputSchema: {
        amount: z.number().positive().describe("Amount in the source currency"),
        from: currency,
        to: currency,
      },
    },
    async ({ amount, from, to }) => {
      try {
        const quote = await latestRate(from, to);
        return text({
          amount,
          from: quote.from,
          to: quote.to,
          rate: quote.rate,
          converted: Math.round(amount * quote.rate * 100) / 100,
          date: quote.date,
        });
      } catch (error) {
        return text({ error: error instanceof Error ? error.message : "Conversion failed" }, true);
      }
    },
  );

  return server;
}

if (isDirectRun(import.meta.url)) {
  listen(createMcpApp(buildFxServer), Number(process.env.PORT ?? 8080));
}
