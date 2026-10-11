export type Role = "admin" | "member";
export type ServerStatus = "connected" | "unreachable" | "disabled";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt?: string;
}

export interface McpServer {
  id: string;
  name: string;
  slug: string;
  url: string;
  authType: "none" | "bearer" | "header";
  authHeader: string | null;
  hasCredential: boolean;
  enabled: boolean;
  status: ServerStatus;
  lastError: string | null;
  tools: Array<{ name: string; description?: string }>;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  userId: string;
  userEmail: string;
  name: string;
  prefix: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  userEmail: string;
  serverSlug: string;
  tool: string;
  startedAt: string;
  durationMs: number;
  success: boolean;
  error: string | null;
}

export interface Store {
  id: string;
  name: string;
  slug: string;
  namespace: string;
  status: "provisioning" | "ready" | "failed" | "deleting";
  url: string;
  error: string | null;
  detail: string | null;
  createdAt: string;
  ownerEmail: string;
  toolPrefix: string;
}

export interface ChatTrace {
  name: string;
  arguments: unknown;
  result: string;
  isError: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    credentials: "include",
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T);
  if (!response.ok) throw new ApiError(response.status, (data as { error?: string }).error ?? response.statusText);
  return data;
}

export const api = {
  me: () => request<User>("/api/me"),
  login: (email: string, password: string) => request<User>("/api/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>("/api/logout", { method: "POST" }),
  servers: () => request<McpServer[]>("/api/servers"),
  refreshServers: () => request<McpServer[]>("/api/servers/refresh", { method: "POST" }),
  createServer: (body: unknown) => request<McpServer>("/api/servers", { method: "POST", body: JSON.stringify(body) }),
  updateServer: (id: string, body: unknown) => request<McpServer>(`/api/servers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteServer: (id: string) => request<{ ok: boolean }>(`/api/servers/${id}`, { method: "DELETE" }),
  users: () => request<User[]>("/api/users"),
  createUser: (body: unknown) => request<User>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  keys: () => request<ApiKey[]>("/api/keys"),
  createKey: (body: { name: string; userId?: string }) => request<ApiKey & { token: string }>("/api/keys", { method: "POST", body: JSON.stringify(body) }),
  revokeKey: (id: string) => request<{ ok: boolean }>(`/api/keys/${id}/revoke`, { method: "POST" }),
  audit: () => request<AuditRow[]>("/api/audit"),
  stores: () => request<Store[]>("/api/stores"),
  createStore: (name: string, password: string, confirmPassword: string) =>
    request<Store>("/api/stores", { method: "POST", body: JSON.stringify({ name, password, confirmPassword }) }),
  deleteStore: (id: string) => request<Store>(`/api/stores/${id}`, { method: "DELETE" }),
  retryStore: (id: string) => request<Store>(`/api/stores/${id}/retry`, { method: "POST" }),
  chat: (message: string, history: Array<{ role: "user" | "assistant"; content: string }>) =>
    request<{ message: string; toolCalls: ChatTrace[] }>("/api/chat", { method: "POST", body: JSON.stringify({ message, history }) }),
};
