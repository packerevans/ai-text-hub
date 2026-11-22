import OAuthProvider from "@cloudflare/workers-oauth-provider";
import {
  clearSessionCookie,
  createCsrfToken,
  createSessionCookie,
  extractBearerOrApiKey,
  generateApiKey,
  hashPassword,
  isSessionValid,
  randomHex,
  sha256Hex,
  timingSafeEqualStr,
  verifyCsrfToken,
  verifyPassword,
} from "./crypto";
import {
  ackOutboxItem,
  checkAuthRateLimit,
  claimPendingOutbox,
  ensureSchema,
  getConfig,
  importContacts,
  ingestMessages,
  parseCustomDelimitedMessages,
  parseVcf,
  releaseOutboxItem,
  resetAuthRateLimit,
  type IncomingMessageInput,
} from "./db";
import { handleMcpRequest } from "./mcp";
import type { AllowlistRow, Env, OAuthUserProps } from "./types";
import {
  renderDashboardPage,
  renderLoginPage,
  renderOAuthAuthorizePage,
  renderSetupPage,
} from "./ui";

function getClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || "local";
}

async function verifyShortcutApiKey(request: Request, env: Env): Promise<boolean> {
  const config = await getConfig(env.DB);
  if (!config) return false;
  const presented = extractBearerOrApiKey(request);
  if (!presented) return false;
  const hash = await sha256Hex(presented);
  return timingSafeEqualStr(hash, config.api_key_hash);
}

async function verifyMcpBearerFallback(request: Request, env: Env): Promise<boolean> {
  const config = await getConfig(env.DB);
  if (!config || !config.mcp_bearer_enabled || !config.mcp_bearer_hash) return false;
  const presented = extractBearerOrApiKey(request);
  if (!presented) return false;
  const hash = await sha256Hex(presented);
  return timingSafeEqualStr(hash, config.mcp_bearer_hash);
}

const defaultHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await ensureSchema(env.DB);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // ── 1. iOS Shortcut API Endpoints (Header API-Key Auth, 100% separate from OAuth) ──
    if (path === "/api/outbox" && method === "GET") {
      if (!(await verifyShortcutApiKey(request, env))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const items = await claimPendingOutbox(env.DB, 10);
      return Response.json({
        count: items.length,
        items: items.map((i) => ({
          id: i.id,
          chat_title: i.chat_title,
          recipients: i.recipients,
          body: i.body,
          require_approval: i.require_approval === 1,
        })),
      });
    }

    const ackMatch = path.match(/^\/api\/outbox\/([a-zA-Z0-9_-]+)\/ack$/);
    if (ackMatch && method === "POST") {
      if (!(await verifyShortcutApiKey(request, env))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const deleted = await ackOutboxItem(env.DB, ackMatch[1]);
      return Response.json({ ok: true, acked: deleted });
    }

    const releaseMatch = path.match(/^\/api\/outbox\/([a-zA-Z0-9_-]+)\/release$/);
    if (releaseMatch && method === "POST") {
      if (!(await verifyShortcutApiKey(request, env))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const released = await releaseOutboxItem(env.DB, releaseMatch[1]);
      return Response.json({ ok: true, released });
    }

    if (path === "/api/ai-status" && method === "GET") {
      if (!(await verifyShortcutApiKey(request, env))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const row = await env.DB.prepare("SELECT value FROM user_preferences WHERE key = 'ai_listening_until'").first<{ value: string }>();
      const until = row ? parseInt(row.value, 10) || 0 : 0;
      return Response.json({ ok: true, listening: until > Date.now() ? 1 : 0 });
    }

    if (path === "/api/ai-status" && method === "POST") {
      if (!(await verifyShortcutApiKey(request, env)) && !(await verifyMcpBearerFallback(request, env))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const body = (await request.json().catch(() => ({}))) as { listening?: boolean; ttl_seconds?: number };
      const ttlMs = Math.min(45, Math.max(2, Number(body.ttl_seconds) || 20)) * 1000;
      const until = body.listening ? Date.now() + ttlMs : 0;
      await env.DB.prepare(
        `INSERT INTO user_preferences (key, value, updated_at)
         VALUES ('ai_listening_until', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
        .bind(String(until), Date.now())
        .run();
      return Response.json({ ok: true, listening: until > Date.now() ? 1 : 0 });
    }

    if (path === "/api/messages" && method === "POST") {
      if (!(await verifyShortcutApiKey(request, env))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const ct = (request.headers.get("Content-Type") || "").toLowerCase();
      let items: IncomingMessageInput[] = [];
      if (ct.includes("application/json")) {
        const body = (await request.json().catch(() => null)) as
          | IncomingMessageInput
          | IncomingMessageInput[]
          | { messages?: IncomingMessageInput[]; text?: string }
          | null;
        if (Array.isArray(body)) items = body;
        else if (body && "messages" in body && Array.isArray(body.messages)) items = body.messages;
        else if (body && "text" in body && typeof body.text === "string") items = parseCustomDelimitedMessages(body.text);
        else if (body && "body" in body) items = [body as IncomingMessageInput];
      } else {
        const raw = await request.text();
        items = parseCustomDelimitedMessages(raw);
      }
      const stats = await ingestMessages(env.DB, items);
      return Response.json({ ok: true, processed: true, ...stats });
    }

    // ── 2. First-Run Setup (/setup) ──
    const config = await getConfig(env.DB);
    if (!config) {
      if (path === "/setup" && method === "POST") {
        const ip = getClientIp(request);
        if (!(await checkAuthRateLimit(env.DB, ip))) {
          return renderSetupPage("Too many attempts. Try again in 15 minutes.");
        }
        const form = await request.formData();
        const password = String(form.get("password") || "");
        const confirm = String(form.get("confirm") || "");
        if (password.length < 10) return renderSetupPage("Password must be at least 10 characters.");
        if (password !== confirm) return renderSetupPage("Passwords do not match.");

        const { hash: pwHash, salt: pwSalt } = await hashPassword(password);
        const sessionSecret = randomHex(32);
        const { key: apiKey, prefixDisplay } = generateApiKey("ath");
        const apiKeyHash = await sha256Hex(apiKey);

        await env.DB.prepare(
          `INSERT INTO config
            (id, password_hash, password_salt, session_secret, api_key_hash, api_key_prefix, created_at)
           VALUES (1, ?, ?, ?, ?, ?, ?)`
        )
          .bind(pwHash, pwSalt, sessionSecret, apiKeyHash, prefixDisplay, Date.now())
          .run();

        await resetAuthRateLimit(env.DB, ip);
        const cookie = await createSessionCookie(sessionSecret);
        const newConfig = (await getConfig(env.DB))!;
        const csrfToken = await createCsrfToken(sessionSecret);
        const resp = renderDashboardPage({
          origin: url.origin,
          config: newConfig,
          csrfToken,
          contactCount: 0,
          chatCount: 0,
          pendingOutbox: 0,
          allowlist: [],
          grants: [],
          freshApiKey: apiKey,
          notice: "Hub initialized! Save your Shortcut API Key below before leaving this page.",
        });
        resp.headers.set("Set-Cookie", cookie);
        return resp;
      }
      if (path === "/" || path === "/setup" || path === "/dashboard") {
        return renderSetupPage();
      }
      return Response.redirect(`${url.origin}/setup`, 302);
    }

    // ── 3. Login / Logout ──
    if (path === "/login" && method === "GET") {
      return renderLoginPage(undefined, url.searchParams.get("next") || "/dashboard");
    }

    if (path === "/login" && method === "POST") {
      const ip = getClientIp(request);
      if (!(await checkAuthRateLimit(env.DB, ip))) {
        return renderLoginPage("Too many failed attempts. Wait 15 minutes.");
      }
      const form = await request.formData();
      const password = String(form.get("password") || "");
      const next = String(form.get("next") || "/dashboard");
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

      if (!(await verifyPassword(password, config.password_hash, config.password_salt))) {
        return renderLoginPage("Incorrect password.", safeNext);
      }
      await resetAuthRateLimit(env.DB, ip);
      const cookie = await createSessionCookie(config.session_secret);
      return new Response(null, {
        status: 302,
        headers: { Location: safeNext, "Set-Cookie": cookie },
      });
    }

    if (path === "/logout" && method === "POST") {
      return new Response(null, {
        status: 302,
        headers: { Location: "/login", "Set-Cookie": clearSessionCookie() },
      });
    }

    // ── 4. OAuth 2.1 Authorization Screen (/authorize) ──
    if (path === "/authorize" && method === "GET") {
      const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      if (!oauthReq.clientId) {
        return new Response("Invalid OAuth request", { status: 400 });
      }
      const clientInfo = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
      const csrfToken = await createCsrfToken(config.session_secret);
      const authNonce = randomHex(16);
      await env.OAUTH_KV.put(`auth_req:${authNonce}`, JSON.stringify(oauthReq), {
        expirationTtl: 600,
      });
      return renderOAuthAuthorizePage({
        clientName: clientInfo?.clientName || oauthReq.clientId,
        csrfToken,
        authNonce,
      });
    }

    if (path === "/authorize" && method === "POST") {
      const ip = getClientIp(request);
      const form = await request.formData();
      const csrf = String(form.get("csrf") || "");
      const authNonce = String(form.get("auth_nonce") || "");
      const password = String(form.get("password") || "");
      const scopes = form.getAll("scope").map(String).filter(Boolean);

      if (!/^[a-f0-9]{32}$/.test(authNonce)) {
        return new Response("Invalid or expired authorization request.", { status: 400 });
      }
      const storedReqJson = await env.OAUTH_KV.get(`auth_req:${authNonce}`);
      if (!storedReqJson) {
        return new Response("Authorization request expired. Please start again from your AI client.", { status: 400 });
      }
      const oauthReq = JSON.parse(storedReqJson);
      const clientInfo = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
      const clientName = clientInfo?.clientName || oauthReq.clientId;

      if (!(await verifyCsrfToken(csrf, config.session_secret))) {
        return renderOAuthAuthorizePage({
          clientName,
          csrfToken: await createCsrfToken(config.session_secret),
          authNonce,
          error: "Session expired. Please try again.",
        });
      }
      if (!(await checkAuthRateLimit(env.DB, ip))) {
        return renderOAuthAuthorizePage({
          clientName,
          csrfToken: await createCsrfToken(config.session_secret),
          authNonce,
          error: "Too many failed attempts. Wait 15 minutes.",
        });
      }
      if (!(await verifyPassword(password, config.password_hash, config.password_salt))) {
        return renderOAuthAuthorizePage({
          clientName,
          csrfToken: await createCsrfToken(config.session_secret),
          authNonce,
          error: "Incorrect Master Password.",
        });
      }

      await env.OAUTH_KV.delete(`auth_req:${authNonce}`);
      await resetAuthRateLimit(env.DB, ip);
      const finalScopes = scopes.length > 0 ? scopes : ["messages:read", "contacts:read"];
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId: "owner",
        metadata: { label: clientName },
        scope: finalScopes,
        props: { sub: "owner", scopes: finalScopes, clientLabel: clientName } satisfies OAuthUserProps,
      });
      return Response.redirect(redirectTo, 302);
    }

    // ── 5. Authenticated Dashboard & Management Routes ──
    const authed = await isSessionValid(request, config.session_secret);
    if (!authed) {
      return Response.redirect(`${url.origin}/login?next=${encodeURIComponent(path)}`, 302);
    }

    if (path === "/api/contacts/upload" && method === "POST") {
      const csrf = request.headers.get("X-CSRF-Token") || "";
      if (!(await verifyCsrfToken(csrf, config.session_secret))) {
        return Response.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
      }
      const vcfText = await request.text();
      const parsed = parseVcf(vcfText);
      const imported = await importContacts(env.DB, parsed);
      return Response.json({ ok: true, imported });
    }

    if (path === "/api/rotate-key" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), config.session_secret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const { key, prefixDisplay } = generateApiKey("ath");
      const hash = await sha256Hex(key);
      await env.DB.prepare("UPDATE config SET api_key_hash = ?, api_key_prefix = ? WHERE id = 1")
        .bind(hash, prefixDisplay)
        .run();
      return renderDashboardFromState(env, url.origin, {
        freshApiKey: key,
        notice: "Shortcut API Key rotated. Update your iPhone Shortcut with the new key below.",
      });
    }

    if (path === "/api/mcp-bearer" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), config.session_secret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const action = String(form.get("action") || "");
      if (action === "disable") {
        await env.DB.prepare("UPDATE config SET mcp_bearer_enabled = 0, mcp_bearer_hash = NULL WHERE id = 1").run();
        return Response.redirect(`${url.origin}/dashboard`, 302);
      }
      const { key } = generateApiKey("ath_mcp");
      const hash = await sha256Hex(key);
      await env.DB.prepare("UPDATE config SET mcp_bearer_enabled = 1, mcp_bearer_hash = ? WHERE id = 1")
        .bind(hash)
        .run();
      return renderDashboardFromState(env, url.origin, {
        freshMcpBearer: key,
        notice: "Static MCP Bearer token enabled for CLI / Grok API clients.",
      });
    }

    if (path === "/api/settings" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), config.session_secret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const cap = Math.min(100, Math.max(1, parseInt(String(form.get("hourly_send_cap") || "10"), 10) || 10));
      const allowOnly = form.get("allowlist_only") === "1" ? 1 : 0;
      const reqApp = form.get("require_approval_default") === "1" ? 1 : 0;
      await env.DB.prepare(
        "UPDATE config SET hourly_send_cap = ?, allowlist_only = ?, require_approval_default = ? WHERE id = 1"
      )
        .bind(cap, allowOnly, reqApp)
        .run();
      return Response.redirect(`${url.origin}/dashboard`, 302);
    }

    if (path === "/api/allowlist/add" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), config.session_secret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const targetType = form.get("target_type") === "chat" ? "chat" : "phone";
      const targetValue = String(form.get("target_value") || "").trim();
      const label = String(form.get("label") || "").trim();
      if (targetValue) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO allowlist (target_type, target_value, label, auto_send, created_at)
           VALUES (?, ?, ?, 1, ?)`
        )
          .bind(targetType, targetValue, label, Date.now())
          .run();
      }
      return Response.redirect(`${url.origin}/dashboard`, 302);
    }

    if (path === "/api/allowlist/delete" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), config.session_secret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const id = parseInt(String(form.get("id") || "0"), 10);
      if (id > 0) await env.DB.prepare("DELETE FROM allowlist WHERE id = ?").bind(id).run();
      return Response.redirect(`${url.origin}/dashboard`, 302);
    }

    if (path === "/api/clients/revoke" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), config.session_secret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const grantId = String(form.get("grantId") || "");
      if (grantId) await env.OAUTH_PROVIDER.revokeGrant(grantId, "owner");
      return Response.redirect(`${url.origin}/dashboard`, 302);
    }

    if (path === "/" || path === "/dashboard") {
      return renderDashboardFromState(env, url.origin);
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function renderDashboardFromState(
  env: Env,
  origin: string,
  extra?: { freshApiKey?: string; freshMcpBearer?: string; notice?: string }
): Promise<Response> {
  const config = (await getConfig(env.DB))!;
  const [contacts, chats, outbox, allowlistRes, grantsRes, csrfToken] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as c FROM contacts").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(DISTINCT chat_key) as c FROM messages").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM outbox").first<{ c: number }>(),
    env.DB.prepare("SELECT * FROM allowlist ORDER BY created_at DESC").all<AllowlistRow>(),
    env.OAUTH_PROVIDER.listUserGrants("owner"),
    createCsrfToken(config.session_secret),
  ]);

  return renderDashboardPage({
    origin,
    config,
    csrfToken,
    contactCount: contacts?.c ?? 0,
    chatCount: chats?.c ?? 0,
    pendingOutbox: outbox?.c ?? 0,
    allowlist: allowlistRes.results || [],
    grants: (grantsRes.items || []).map((g) => ({
      id: g.id,
      clientId: g.clientId,
      scope: g.scope,
      createdAt: g.createdAt,
    })),
    ...extra,
  });
}

const providerCache = new Map<string, OAuthProvider<Env>>();

function getOAuthProvider(origin: string): OAuthProvider<Env> {
  let provider = providerCache.get(origin);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: {
        async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
          const props = (ctx as unknown as { props?: OAuthUserProps }).props;
          const scopes = props?.scopes || ["messages:read", "contacts:read", "outbox:write"];
          return handleMcpRequest(request, env, ctx, scopes);
        },
      },
      defaultHandler,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      resourceMetadata: {
        resource: `${origin}/mcp`,
        scopes_supported: ["messages:read", "contacts:read", "outbox:write"],
      },
    });
    providerCache.set(origin, provider);
  }
  return provider;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Optional dual-auth fallback: allow static MCP Bearer token on /mcp if explicitly enabled in dashboard
    if (url.pathname === "/mcp" && (await verifyMcpBearerFallback(request, env))) {
      return handleMcpRequest(request, env, ctx, ["*"]);
    }
    // Serve RFC 9728 protected-resource metadata at both root and /mcp suffix for maximum MCP client compatibility
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      const rewritten = new URL(request.url);
      rewritten.pathname = "/.well-known/oauth-protected-resource/mcp";
      return getOAuthProvider(url.origin).fetch(new Request(rewritten, request), env, ctx);
    }
    return getOAuthProvider(url.origin).fetch(request, env, ctx);
  },
};
