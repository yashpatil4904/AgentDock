import type { ExposedTool } from "./types.js";

export const searchToolName = "search_tools";
export const callToolName = "call_tool";

export const searchTool: ExposedTool = {
  name: searchToolName,
  description: "Find upstream tools by keyword. Use this before call_tool when the catalog is large. Returns matching names and descriptions.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", description: "Words to match against tool names and descriptions" } },
    required: ["query"],
  },
};

export const callTool: ExposedTool = {
  name: callToolName,
  description: "Call one upstream tool by its exact prefixed name, for example woocommerce__list_orders. Pass the tool arguments in arguments.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Exact tool name from search_tools" },
      arguments: { type: "object", description: "Arguments for that tool" },
    },
    required: ["name"],
  },
};

export function directToolLimit(): number {
  const parsed = Number(process.env.TOOL_DIRECT_LIMIT ?? 8);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
}

export interface ToolIndex {
  /** token -> tool name -> weight. Name tokens weigh more than description tokens. */
  postings: Map<string, Map<string, number>>;
  search(query: string, limit?: number): ExposedTool[];
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);
}

/** Build an inverted index over tool names and descriptions. */
export function buildToolIndex(tools: ExposedTool[]): ToolIndex {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const postings = new Map<string, Map<string, number>>();
  const add = (token: string, name: string, weight: number) => {
    let bucket = postings.get(token);
    if (!bucket) {
      bucket = new Map();
      postings.set(token, bucket);
    }
    bucket.set(name, (bucket.get(name) ?? 0) + weight);
  };
  for (const tool of tools) {
    for (const token of tokens(tool.name)) add(token, tool.name, 3);
    for (const token of tokens(tool.description)) add(token, tool.name, 1);
  }
  return {
    postings,
    search(query: string, limit = 8): ExposedTool[] {
      const terms = tokens(query);
      if (!terms.length) return [];
      const scores = new Map<string, number>();
      for (const term of terms) {
        const bucket = postings.get(term);
        if (!bucket) continue;
        for (const [name, weight] of bucket) scores.set(name, (scores.get(name) ?? 0) + weight);
      }
      return [...scores.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, limit)
        .flatMap(([name]) => {
          const tool = byName.get(name);
          return tool ? [tool] : [];
        });
    },
  };
}

/** Rank tools by how many query words appear in the name or description. */
export function searchTools(tools: ExposedTool[], query: string, limit = 8): ExposedTool[] {
  return buildToolIndex(tools).search(query, limit);
}

export function formatSearchHits(tools: ExposedTool[]): string {
  if (!tools.length) return "No tools matched. Try a shorter query, such as orders, products, weather, or rate.";
  return tools.map((tool) => `${tool.name}: ${tool.description}`).join("\n");
}
