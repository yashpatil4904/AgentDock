import type { Role } from "./types.js";

const writeTool = /^(create|update|delete|remove)_/;

/** The bare tool name, after the server prefix. */
export function bareToolName(toolName: string): string {
  const index = toolName.indexOf("__");
  return index === -1 ? toolName : toolName.slice(index + 2);
}

export function isWriteTool(toolName: string): boolean {
  return writeTool.test(bareToolName(toolName));
}

/** Members can list and read. Creating, updating, and deleting stay with admins. */
export function toolAllowed(role: Role, toolName: string): boolean {
  if (role === "admin") return true;
  return !isWriteTool(toolName);
}

export function permissionError(toolName: string): string {
  return `Tool "${toolName}" is limited to admins. Members can read, not create, update, or delete.`;
}
