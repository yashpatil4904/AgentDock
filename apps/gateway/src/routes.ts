import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { runChat } from "./chat.js";
import { generateApiKey, hashApiKey, verifyPassword } from "./crypto.js";
import {
  createSession,
  createUser,
  deleteServer,
  deleteSession,
  findUserByApiKeyHash,
  findUserByEmail,
  findUserById,
  findUserBySession,
  insertApiKey,
  insertServer,
  listApiKeys,
  listAudit,
  listPublicServers,
  listUsers,
  revokeApiKey,
  updateServer,
} from "./db.js";
import { HttpError } from "./errors.js";
import { assertSlug, slugFromName } from "./routing.js";
import { pollOnce } from "./poller.js";
import type { AuthType, User } from "./types.js";
import { assertUpstreamUrl } from "./url-guard.js";

const COOKIE = "ad_session";

export interface AppResponse extends Response {
  locals: { user?: User };
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function setSessionCookie(res: Response, token: string): void {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax${secure}`);
}

function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

async function requireUser(req: Request, res: AppResponse, next: NextFunction): Promise<void> {
  const token = cookieValue(req.header("cookie"), COOKIE);
  if (!token) {
    next(new HttpError(401, "Login required"));
    return;
  }
  const user = await findUserBySession(token);
  if (!user) {
    next(new HttpError(401, "Login required"));
    return;
  }
  res.locals.user = user;
  next();
}

function requireAdmin(req: Request, res: AppResponse, next: NextFunction): void {
  if (res.locals.user?.role !== "admin") {
    next(new HttpError(403, "Admin role required"));
    return;
  }
  next();
}

const authType = z.enum(["none", "bearer", "header"]);

const serverBody = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(40).optional(),
  url: z.string().min(1).max(2000),
  authType: authType.default("none"),
  authHeader: z.string().min(1).max(64).optional(),
  credential: z.string().max(4096).optional(),
  enabled: z.boolean().default(true),
});

function idParam(value: string | string[]): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw new HttpError(400, "Missing id");
  return id;
}

function credentialFor(input: { authType: AuthType; authHeader?: string; credential?: string }): { authHeader: string | null; credential: string | null } {
  if (input.authType === "none") return { authHeader: null, credential: null };
  if (input.authType === "header" && !input.authHeader) throw new HttpError(400, "Header auth needs a header name");
  if (!input.credential) throw new HttpError(400, "This auth type needs a credential");
  return { authHeader: input.authType === "header" ? input.authHeader ?? null : null, credential: input.credential };
}

export const api = Router();

api.post("/login", async (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const user = await findUserByEmail(body.email);
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) throw new HttpError(401, "Invalid email or password");
  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

api.post("/logout", async (req, res) => {
  const token = cookieValue(req.header("cookie"), COOKIE);
  if (token) await deleteSession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

api.get("/me", requireUser, (req, res: AppResponse) => {
  res.json(res.locals.user);
});

api.get("/servers", requireUser, async (_req, res) => {
  res.json(await listPublicServers());
});

api.post("/servers/refresh", requireUser, requireAdmin, async (_req, res) => {
  await pollOnce();
  res.json(await listPublicServers());
});

api.post("/servers", requireUser, requireAdmin, async (req, res) => {
  const body = serverBody.parse(req.body);
  const slug = body.slug ?? slugFromName(body.name);
  assertSlug(slug);
  assertUpstreamUrl(body.url);
  const secret = credentialFor(body);
  try {
    const created = await insertServer({
      name: body.name,
      slug,
      url: body.url,
      authType: body.authType,
      authHeader: secret.authHeader,
      credential: secret.credential,
      enabled: body.enabled,
    });
    res.status(201).json(created);
  } catch (error) {
    if (error instanceof Error && /duplicate key/.test(error.message)) throw new HttpError(409, "A server with that slug already exists");
    throw error;
  }
});

api.patch("/servers/:id", requireUser, requireAdmin, async (req, res) => {
  const body = serverBody.extend({ clearCredential: z.boolean().optional(), credential: z.string().max(4096).optional() }).parse(req.body);
  assertUpstreamUrl(body.url);
  if (body.authType === "header" && !body.authHeader) throw new HttpError(400, "Header auth needs a header name");
  const updated = await updateServer(idParam(req.params.id), {
    name: body.name,
    url: body.url,
    authType: body.authType,
    authHeader: body.authType === "header" ? body.authHeader ?? null : null,
    credential: body.credential,
    clearCredential: Boolean(body.clearCredential) || body.authType === "none",
    enabled: body.enabled,
  });
  if (!updated) throw new HttpError(404, "Server not found");
  res.json(updated);
});

api.delete("/servers/:id", requireUser, requireAdmin, async (req, res) => {
  if (!(await deleteServer(idParam(req.params.id)))) throw new HttpError(404, "Server not found");
  res.json({ ok: true });
});

api.get("/users", requireUser, requireAdmin, async (_req, res) => {
  res.json(await listUsers());
});

api.post("/users", requireUser, requireAdmin, async (req, res) => {
  const body = z.object({
    email: z.string().email(),
    name: z.string().min(1).max(80),
    password: z.string().min(8).max(200),
    role: z.enum(["admin", "member"]),
  }).parse(req.body);
  try {
    const user = await createUser(body);
    res.status(201).json(user);
  } catch (error) {
    if (error instanceof Error && /duplicate key/.test(error.message)) throw new HttpError(409, "A user with that email already exists");
    throw error;
  }
});

api.get("/keys", requireUser, async (_req, res: AppResponse) => {
  const user = res.locals.user as User;
  res.json(await listApiKeys(user.role === "admin" ? undefined : user.id));
});

api.post("/keys", requireUser, async (req, res: AppResponse) => {
  const user = res.locals.user as User;
  const body = z.object({ name: z.string().min(1).max(80).default("default"), userId: z.string().uuid().optional() }).parse(req.body);
  let userId = user.id;
  if (body.userId && body.userId !== user.id) {
    if (user.role !== "admin") throw new HttpError(403, "Only an admin can issue a key for someone else");
    if (!(await findUserById(body.userId))) throw new HttpError(404, "User not found");
    userId = body.userId;
  }
  const generated = generateApiKey();
  const saved = await insertApiKey({ userId, name: body.name, prefix: generated.prefix, hash: generated.hash });
  res.status(201).json({ id: saved.id, name: body.name, prefix: generated.prefix, token: generated.token });
});

api.post("/keys/:id/revoke", requireUser, async (req, res: AppResponse) => {
  const user = res.locals.user as User;
  const revoked = await revokeApiKey(idParam(req.params.id), user.role === "admin" ? undefined : user.id);
  if (!revoked) throw new HttpError(404, "Active key not found");
  res.json({ ok: true });
});

api.get("/audit", requireUser, async (_req, res: AppResponse) => {
  const user = res.locals.user as User;
  res.json(await listAudit(user.role === "admin" ? undefined : user.id));
});

api.post("/chat", requireUser, async (req, res: AppResponse) => {
  const user = res.locals.user as User;
  const body = z.object({
    message: z.string().min(1).max(4000),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(20).default([]),
  }).parse(req.body);
  res.json(await runChat(user, body.message, body.history));
});

export async function userFromApiKey(header: string | undefined): Promise<User | null> {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  if (!match?.[1]) return null;
  return findUserByApiKeyHash(hashApiKey(match[1]));
}
