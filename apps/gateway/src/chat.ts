import { HttpError } from "./errors.js";
import { callAggregatedTool, listAggregatedTools } from "./tools.js";
import type { User } from "./types.js";

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface GroqToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatTrace {
  name: string;
  arguments: unknown;
  result: string;
  isError: boolean;
}

export async function runChat(user: User, message: string, history: HistoryMessage[]): Promise<{ message: string; toolCalls: ChatTrace[] }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new HttpError(503, "GROQ_API_KEY is not configured");

  const tools = await listAggregatedTools();
  const groqTools = tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const messages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content: [
        "You are the AgentDock assistant. You act for the signed-in user by calling tools. You have no direct access to the store.",
        "Tool names are prefixed with the upstream server: {slug}__{tool}. Use woocommerce__ tools for products and orders, weather__get_forecast for weather, and fx__convert or fx__get_rate for currency.",
        `Today is ${today}. Tomorrow is ${tomorrow}. For orders placed today, call woocommerce__list_orders with after ${today}T00:00:00 and before ${tomorrow}T00:00:00.`,
        "Prices are decimal strings without a currency symbol. Do not invent products or orders. If a tool returns an error, say what failed.",
      ].join(" "),
    },
    ...history.slice(-8).map((item) => ({ role: item.role, content: item.content })),
    { role: "user", content: message },
  ];

  const trace: ChatTrace[] = [];
  for (let step = 0; step < 6; step += 1) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        messages,
        tools: groqTools.length ? groqTools : undefined,
        tool_choice: groqTools.length ? "auto" : undefined,
        temperature: 0.2,
      }),
    });
    const raw = await response.text();
    if (!response.ok) throw new HttpError(502, `Groq request failed (${response.status}): ${raw.slice(0, 400)}`);
    const data = JSON.parse(raw) as { choices?: Array<{ message?: { role?: string; content?: string | null; tool_calls?: GroqToolCall[] } }> };
    const assistant = data.choices?.[0]?.message;
    if (!assistant) throw new HttpError(502, "Groq returned no message");
    if (!assistant.tool_calls?.length) return { message: assistant.content ?? "", toolCalls: trace };

    messages.push(assistant);
    for (const call of assistant.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(call.function.arguments || "{}") as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch {
        args = {};
      }
      const result = await callAggregatedTool(user, call.function.name, args);
      const resultText = result.content.map((block) => block.text).join("\n");
      trace.push({ name: call.function.name, arguments: args, result: resultText, isError: Boolean(result.isError) });
      messages.push({ role: "tool", tool_call_id: call.id, content: resultText });
    }
  }
  return { message: "Stopped after several tool calls. Ask a narrower question.", toolCalls: trace };
}
