import {
  AuthorizationError,
  CimdFetchError,
  OAuthProvider,
  authorizationErrorRedirect,
  insufficientScope,
  type ConsentDescription,
  type OAuthHelpers,
  type OAuthResourceAuth,
} from "@cloudflare/workers-oauth-provider";
import { escapeHtml } from "./config";
import type { Env } from "./types";

const VOICE_SCOPE = "voice:speak";
const PRIVATE_ROUTES = ["/mcp", "/sse", "/panel", "/speak", "/history", "/events/latest"];

export interface AuthConfig {
  baseUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  allowedGithubId: number;
}

export function getAuthMode(env: Env): "none" | "oauth" | "invalid" {
  const mode = env.AUTH_MODE?.trim().toLowerCase() || "oauth";
  return mode === "none" || mode === "oauth" ? mode : "invalid";
}

export function getAuthConfig(env: Env): AuthConfig | null {
  if (!env.AUTH_BASE_URL || !env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET || !env.AUTH_ALLOWED_GITHUB_ID || !env.OAUTH_KV) return null;
  let url: URL;
  try {
    url = new URL(env.AUTH_BASE_URL);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
  const allowedGithubId = Number(env.AUTH_ALLOWED_GITHUB_ID);
  if (!Number.isSafeInteger(allowedGithubId) || allowedGithubId <= 0) return null;
  return {
    baseUrl: url.origin,
    githubClientId: env.GITHUB_OAUTH_CLIENT_ID,
    githubClientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
    allowedGithubId,
  };
}

function oauthHelpers(env: Env): OAuthHelpers {
  return (env as Env & { OAUTH_PROVIDER: OAuthHelpers }).OAUTH_PROVIDER;
}

function consentPage(details: ConsentDescription, handle: string): string {
  const scopes = details.scope.map((scope) =>
    `<label><input type="checkbox" name="scope" value="${escapeHtml(scope)}" checked> ${escapeHtml(scope)}</label>`,
  ).join("<br>");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize voice MCP</title>
<main style="font:16px system-ui;max-width:34rem;margin:3rem auto;padding:1rem;line-height:1.5">
<h1>Allow ${escapeHtml(details.clientName)} to use this voice?</h1>
<p>${details.clientDomain ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.` : "This app registered itself; its name is not verified."}</p>
<p>Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? "<p><strong>This sends access to an app on your computer.</strong></p>" : ""}
<p>This lets the app generate speech through your configured TTS providers and read the protected voice endpoints.</p>
<form method="post"><input type="hidden" name="handle" value="${escapeHtml(handle)}">${scopes}
<p><button name="decision" value="approve">Allow</button> <button name="decision" value="deny">Deny</button></p></form>
</main></html>`;
}

function authorizationError(error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
  if (error instanceof AuthorizationError) return new Response(error.description, { status: 400 });
  if (error instanceof CimdFetchError) return new Response("OAuth client could not be verified", { status: 400 });
  return new Response("Authorization unavailable", { status: 503 });
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function authorize(request: Request, env: Env, config: AuthConfig): Promise<Response> {
  const oauth = oauthHelpers(env);
  try {
    if (request.method === "GET") {
      const parsed = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(parsed);
      const consent = await oauth.beginConsent(parsed);
      consent.headers.set("Content-Type", "text/html; charset=utf-8");
      return new Response(consentPage(details, consent.handle), { headers: consent.headers });
    }
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const form = await request.formData();
    const handle = String(form.get("handle") || "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(request, handle, { scope: form.getAll("scope").map(String) });
    const verifier = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const upstream = await oauth.beginUpstream(approved.request, { data: { verifier }, headers: approved.headers });
    const githubUrl = new URL("https://github.com/login/oauth/authorize");
    githubUrl.searchParams.set("client_id", config.githubClientId);
    githubUrl.searchParams.set("redirect_uri", `${config.baseUrl}/callback`);
    githubUrl.searchParams.set("state", upstream.state);
    githubUrl.searchParams.set("code_challenge", await codeChallenge(verifier));
    githubUrl.searchParams.set("code_challenge_method", "S256");
    upstream.headers.set("Location", githubUrl.toString());
    return new Response(null, { status: 302, headers: upstream.headers });
  } catch (error) {
    return authorizationError(error);
  }
}

async function githubIdentity(code: string, verifier: string, config: AuthConfig): Promise<number | null> {
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: `${config.baseUrl}/callback`,
    }),
  });
  if (!tokenResponse.ok) return null;
  const tokenData = await tokenResponse.json() as { access_token?: string };
  if (!tokenData.access_token) return null;
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${tokenData.access_token}`,
      "User-Agent": "voice-mcp",
    },
  });
  if (!userResponse.ok) return null;
  const user = await userResponse.json() as { id?: number };
  return typeof user.id === "number" ? user.id : null;
}

async function callback(request: Request, env: Env, config: AuthConfig): Promise<Response> {
  const oauth = oauthHelpers(env);
  try {
    const resumed = await oauth.finishUpstream<{ verifier: string }>(request);
    const params = new URL(request.url).searchParams;
    const code = params.get("code");
    if (params.has("error") || !code || !resumed.data?.verifier) {
      resumed.headers.set("Location", authorizationErrorRedirect(resumed.request, "access_denied"));
      return new Response(null, { status: 302, headers: resumed.headers });
    }
    const githubId = await githubIdentity(code, resumed.data.verifier, config);
    if (githubId !== config.allowedGithubId) {
      resumed.headers.set("Location", authorizationErrorRedirect(resumed.request, "access_denied"));
      return new Response(null, { status: 302, headers: resumed.headers });
    }
    const completed = await oauth.completeAuthorization({
      request: resumed.request,
      userId: String(githubId),
      metadata: {},
      scope: resumed.request.scope,
      props: { githubId },
    });
    resumed.headers.set("Location", completed.redirectTo);
    return new Response(null, { status: 302, headers: resumed.headers });
  } catch (error) {
    return authorizationError(error);
  }
}

export function createOAuthWorker(
  config: AuthConfig,
  protectedHandler: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>,
  publicHandler: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>,
): OAuthProvider<Env> {
  return new OAuthProvider<Env>({
    apiRoute: PRIVATE_ROUTES,
    apiHandler: {
      async fetch(request, env, ctx) {
        const auth = (ctx as ExecutionContext & { auth?: OAuthResourceAuth }).auth;
        if (!auth?.scope.includes(VOICE_SCOPE)) return auth ? insufficientScope(auth, [VOICE_SCOPE]) : new Response("Unauthorized", { status: 401 });
        return protectedHandler(request, env, ctx);
      },
    },
    defaultHandler: {
      async fetch(request, env, ctx) {
        const path = new URL(request.url).pathname;
        if (path === "/authorize") return authorize(request, env, config);
        if (path === "/callback" && request.method === "GET") return callback(request, env, config);
        return publicHandler(request, env, ctx);
      },
    },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/register",
    scopesSupported: [VOICE_SCOPE, "offline_access"],
    resourceMetadata: {
      resource: config.baseUrl,
      authorization_servers: [config.baseUrl],
    },
    requiredScopes: [VOICE_SCOPE],
    clientIdMetadataDocumentEnabled: true,
  });
}
