import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { hashApiKey, verifyPassword } from "./crypto.js";
import {
  createOAuthClient,
  createSession,
  findOAuthClient,
  findUserByEmail,
  findUserBySession,
  issueOAuthTokens,
  rotateOAuthRefresh,
  saveOAuthCode,
  takeOAuthCode,
} from "./db.js";

const accessTtlSeconds = 60 * 60;
const refreshTtlSeconds = 30 * 24 * 60 * 60;
const codeTtlMs = 5 * 60 * 1000;

export function publicBase(): string {
  return (process.env.GATEWAY_PUBLIC_URL || "http://app.localtest.me").replace(/\/$/, "");
}

export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  const actual = pkceS256(verifier);
  const left = Buffer.from(actual);
  const right = Buffer.from(challenge);
  return left.length === right.length && timingSafeEqual(left, right);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function sessionCookie(token: string): string {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `ad_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax${secure}`;
}

interface AuthorizeQuery {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state?: string;
}

function readAuthorize(req: Request): AuthorizeQuery {
  const source = req.method === "POST" ? (req.body as Record<string, unknown>) : (req.query as Record<string, unknown>);
  return z.object({
    response_type: z.string(),
    client_id: z.string().min(1),
    redirect_uri: z.string().min(1),
    code_challenge: z.string().min(43).max(128),
    code_challenge_method: z.string(),
    state: z.string().optional(),
  }).parse(source);
}

async function clientAllows(query: AuthorizeQuery): Promise<boolean> {
  const client = await findOAuthClient(query.client_id);
  if (!client) return false;
  return client.redirectUris.includes(query.redirect_uri);
}

function loginPage(query: AuthorizeQuery, error: string): string {
  const fields = Object.entries(query)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>AgentDock login</title>
<style>body{font-family:sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem}label{display:block;margin:.8rem 0}input{width:100%;padding:.5rem}</style>
</head><body>
<h1>Connect to AgentDock</h1>
<p>Sign in with your dashboard account. The client receives a token, not your password.</p>
${error ? `<p>${escapeHtml(error)}</p>` : ""}
<form method="post" action="/authorize">
${fields}
<label>Email <input name="email" type="email" required /></label>
<label>Password <input name="password" type="password" required /></label>
<button type="submit">Allow</button>
</form></body></html>`;
}

async function sendCode(res: Response, userId: string, query: AuthorizeQuery): Promise<void> {
  const code = randomBytes(32).toString("base64url");
  await saveOAuthCode({
    codeHash: hashApiKey(code),
    clientId: query.client_id,
    userId,
    redirectUri: query.redirect_uri,
    codeChallenge: query.code_challenge,
    expiresAt: new Date(Date.now() + codeTtlMs),
  });
  const target = new URL(query.redirect_uri);
  target.searchParams.set("code", code);
  if (query.state) target.searchParams.set("state", query.state);
  res.redirect(target.toString());
}

export function mountOAuth(app: Express): void {
  const issuer = () => publicBase();

  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json({
      resource: `${issuer()}/mcp`,
      authorization_servers: [issuer()],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
    });
  });

  app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
    res.redirect(302, "/.well-known/oauth-protected-resource");
  });

  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    const base = issuer();
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    });
  });

  app.post("/register", async (req, res) => {
    const body = z.object({
      client_name: z.string().min(1).max(120).default("MCP client"),
      redirect_uris: z.array(z.string().refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      }, "Redirect URL must be http or https")).min(1).max(8),
    }).parse(req.body);
    const clientId = `oac_${randomBytes(18).toString("base64url")}`;
    await createOAuthClient({ clientId, clientName: body.client_name, redirectUris: body.redirect_uris });
    res.status(201).json({
      client_id: clientId,
      client_name: body.client_name,
      redirect_uris: body.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  app.get("/authorize", async (req, res) => {
    const query = readAuthorize(req);
    if (query.response_type !== "code" || query.code_challenge_method !== "S256") {
      res.status(400).type("html").send(loginPage(query, "Only authorization code with S256 PKCE is supported."));
      return;
    }
    if (!(await clientAllows(query))) {
      res.status(400).type("html").send("<p>Unknown client or redirect URL.</p>");
      return;
    }
    const session = cookieValue(req.header("cookie"), "ad_session");
    const user = session ? await findUserBySession(session) : null;
    if (!user) {
      res.type("html").send(loginPage(query, ""));
      return;
    }
    await sendCode(res, user.id, query);
  });

  app.post("/authorize", async (req, res) => {
    const query = readAuthorize(req);
    const email = z.string().email().parse(req.body?.email);
    const password = z.string().min(1).parse(req.body?.password);
    if (query.response_type !== "code" || query.code_challenge_method !== "S256" || !(await clientAllows(query))) {
      res.status(400).type("html").send("<p>This authorization request is not valid.</p>");
      return;
    }
    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).type("html").send(loginPage(query, "Invalid email or password"));
      return;
    }
    const session = await createSession(user.id);
    res.setHeader("Set-Cookie", sessionCookie(session));
    await sendCode(res, user.id, query);
  });

  app.post("/token", async (req, res) => {
    const body = z.object({
      grant_type: z.string(),
      code: z.string().optional(),
      redirect_uri: z.string().optional(),
      client_id: z.string().optional(),
      code_verifier: z.string().optional(),
      refresh_token: z.string().optional(),
    }).parse(req.body);
    if (body.grant_type === "authorization_code") {
      if (!body.code || !body.redirect_uri || !body.client_id || !body.code_verifier) {
        res.status(400).json({ error: "invalid_request" });
        return;
      }
      const issued = await consumeAuthorizationCode({
        code: body.code,
        redirect_uri: body.redirect_uri,
        client_id: body.client_id,
        code_verifier: body.code_verifier,
      });
      if (!issued) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      res.json(issued);
      return;
    }
    if (body.grant_type === "refresh_token" && body.refresh_token) {
      const rotated = await rotateOAuthRefresh(hashApiKey(body.refresh_token), accessTtlSeconds, refreshTtlSeconds);
      if (!rotated) {
        res.status(400).json({ error: "invalid_grant" });
        return;
      }
      res.json(tokenBody(rotated.accessToken, rotated.refreshToken));
      return;
    }
    res.status(400).json({ error: "unsupported_grant_type" });
  });
}

async function consumeAuthorizationCode(body: { code: string; redirect_uri: string; client_id: string; code_verifier: string }): Promise<Record<string, unknown> | null> {
  const row = await takeOAuthCode(hashApiKey(body.code));
  if (!row) return null;
  if (row.clientId !== body.client_id || row.redirectUri !== body.redirect_uri) return null;
  if (!pkceMatches(body.code_verifier, row.codeChallenge)) return null;
  const tokens = await issueOAuthTokens({
    userId: row.userId,
    clientId: row.clientId,
    accessTtlSeconds,
    refreshTtlSeconds,
  });
  return tokenBody(tokens.accessToken, tokens.refreshToken);
}

function tokenBody(accessToken: string, refreshToken: string): Record<string, unknown> {
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: accessTtlSeconds,
    refresh_token: refreshToken,
    scope: "mcp",
  };
}
