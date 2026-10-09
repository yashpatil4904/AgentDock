export type Role = "admin" | "member";
export type AuthType = "none" | "bearer" | "header";
export type ServerStatus = "connected" | "unreachable" | "disabled";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface PublicServer {
  id: string;
  name: string;
  slug: string;
  url: string;
  authType: AuthType;
  authHeader: string | null;
  hasCredential: boolean;
  enabled: boolean;
  status: ServerStatus;
  lastError: string | null;
  tools: Array<{ name: string; description?: string }>;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface InternalServer {
  id: string;
  name: string;
  slug: string;
  url: string;
  authType: AuthType;
  authHeader: string | null;
  credential: string | null;
  enabled: boolean;
  status: ServerStatus;
}

export interface ExposedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
