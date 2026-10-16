import type { Role } from "./types.js";

/** Bare tool names a member may call on any server. A name that is not listed is denied, including a write that does not start with create_ or update_. */
export const memberToolNames = new Set([
  "list_products",
  "list_orders",
  "get_order",
  "get_forecast",
  "get_rate",
  "convert",
]);

/** The bare tool name, after the server prefix. */
export function bareToolName(toolName: string): string {
  const index = toolName.indexOf("__");
  return index === -1 ? toolName : toolName.slice(index + 2);
}

/** Admins may call any tool. Members may call only the names in memberToolNames. Checked before the upstream call. */
export function toolAllowed(role: Role, toolName: string): boolean {
  if (role === "admin") return true;
  return memberToolNames.has(bareToolName(toolName));
}

export function permissionError(toolName: string): string {
  return `Tool "${toolName}" is not on the member allow list.`;
}
