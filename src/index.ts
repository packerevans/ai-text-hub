import OAuthProvider from "@cloudflare/workers-oauth-provider";
import {
  clearSessionCookie,
  createCsrfToken,
  createSessionCookie,
  extractBearerOrApiKey,
  generateApiKey,
  getSessionUserId,
  hashPassword,
  randomHex,
  sha256Hex,
  verifyCsrfToken,
  verifyPassword,
} from "./crypto";
import {
  ackOutboxItem,
  AI_UNITS_PER_DRAFT,
  checkAuthRateLimit,
  claimPendingOutbox,
  claimShortcutManifest,
  claimStripeSessionOnce,
  countChatParticipants,
  DAILY_FREE_AI_LIMIT,
  ensureSchema,
  findUnknownMessageNumbers,
  getAllPreferences,
  getAppSessionSecret,
  getConfig,
  getEffectiveDailyUsage,
  getUserByApiKeyHash,
  getUserByMcpBearerHash,
  getUserByUsername,
  getUserCount,
  importContacts,
  ingestMessages,
  isContactsSyncNeeded,
  isHostedInstance,
  isShortCodeOrOtp,
  isUserProActive,
  listSignupLogs,
  markContactsSynced,
  parseCustomDelimitedMessages,
  parseVcf,
  queueOutboxItem,
  recordAutoDraftUsage,
  recordSignupLog,
  releaseOutboxItem,
  resetAuthRateLimit,
  type IncomingMessageInput,
} from "./db";
import { handleMcpRequest } from "./mcp";
import type { AllowlistRow, ConfigRow, Env, OAuthUserProps } from "./types";
import {
  renderDashboardPage,
  renderLoginPage,
  renderOAuthAuthorizePage,
  renderSetupPage,
  renderSignupPage,
} from "./ui";

function isValidEmail(val: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val) && val.length <= 120;
}

function getClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || "local";
}

function oauthUserKey(userId: number): string {
  return userId === 1 ? "owner" : String(userId);
}

async function verifyShortcutApiKey(request: Request, env: Env): Promise<ConfigRow | null> {
  const presented = extractBearerOrApiKey(request);
  if (!presented) return null;
  const hash = await sha256Hex(presented);
  return getUserByApiKeyHash(env.DB, hash);
}

async function verifyMcpBearerFallback(request: Request, env: Env): Promise<ConfigRow | null> {
  const presented = extractBearerOrApiKey(request);
  if (!presented) return null;
  const hash = await sha256Hex(presented);
  return getUserByMcpBearerHash(env.DB, hash);
}

const defaultHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await ensureSchema(env.DB);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // ── 1. iOS Shortcut API Endpoints (Header API-Key Auth, 100% separate from OAuth) ──
    if (path === "/api/outbox" && method === "GET") {
      const apiUser = await verifyShortcutApiKey(request, env);
      if (!apiUser) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const [items, manifest, pendingRaw] = await Promise.all([
        claimPendingOutbox(env.DB, 10, apiUser.id),
        claimShortcutManifest(env.DB, apiUser.id),
        env.OAUTH_KV.get(`ai_pending:${apiUser.id}`),
      ]);
      const aiPending = Math.max(0, parseInt(pendingRaw || "0", 10) || 0);
      return Response.json({
        count: items.length,
        ai_pending: aiPending,
        items: items.map((i) => ({
          id: i.id,
          chat_title: i.chat_title,
          recipients: i.recipients,
          body: i.body,
          require_approval: i.require_approval === 1,
        })),
        ...manifest,
      });
    }

    const ackMatch = path.match(/^\/api\/outbox\/([a-zA-Z0-9_-]+)\/ack$/);
    if (ackMatch && method === "POST") {
      const apiUser = await verifyShortcutApiKey(request, env);
      if (!apiUser) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const deleted = await ackOutboxItem(env.DB, ackMatch[1], apiUser.id);
      return Response.json({ ok: true, acked: deleted });
    }

    const releaseMatch = path.match(/^\/api\/outbox\/([a-zA-Z0-9_-]+)\/release$/);
    if (releaseMatch && method === "POST") {
      const apiUser = await verifyShortcutApiKey(request, env);
      if (!apiUser) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const released = await releaseOutboxItem(env.DB, releaseMatch[1], apiUser.id);
      return Response.json({ ok: true, released });
    }

    if (path === "/api/ai-status" && method === "GET") {
      const apiUser = await verifyShortcutApiKey(request, env);
      if (!apiUser) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const [row, syncNeeded] = await Promise.all([
        env.DB.prepare(
          "SELECT value FROM user_preferences WHERE user_id = ? AND key = 'ai_listening_until'"
        )
          .bind(apiUser.id)
          .first<{ value: string }>(),
        isContactsSyncNeeded(env.DB, apiUser.id),
      ]);
      const until = row ? parseInt(row.value, 10) || 0 : 0;
      return Response.json({
        ok: true,
        listening: until > Date.now() ? 1 : 0,
        contacts_sync_needed: syncNeeded ? 1 : 0,
      });
    }

    if (path === "/api/contacts/sync-needed" && method === "GET") {
      const apiUser = await verifyShortcutApiKey(request, env);
      if (!apiUser) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const needed = await isContactsSyncNeeded(env.DB, apiUser.id);
      return Response.json({
        ok: true,
        needed,
        contacts_sync_needed: needed ? 1 : 0,
      });
    }

    if (path === "/api/ai-status" && method === "POST") {
      const apiUser = (await verifyShortcutApiKey(request, env)) || (await verifyMcpBearerFallback(request, env));
      if (!apiUser) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const body = (await request.json().catch(() => ({}))) as { listening?: boolean; ttl_seconds?: number };
      const ttlMs = Math.min(45, Math.max(2, Number(body.ttl_seconds) || 20)) * 1000;
      const until = body.listening ? Date.now() + ttlMs : 0;
      await env.DB.prepare(
        `INSERT INTO user_preferences (user_id, key, value, updated_at)
         VALUES (?, 'ai_listening_until', ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
        .bind(apiUser.id, String(until), Date.now())
        .run();
      return Response.json({ ok: true, listening: until > Date.now() ? 1 : 0 });
    }

    if (path === "/api/contacts/sync" && method === "POST") {
      const apiUser = await verifyShortcutApiKey(request, env);
      if (!apiUser) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const len = parseInt(request.headers.get("Content-Length") || "0", 10);
      if (len > 2 * 1024 * 1024) {
        return Response.json({ error: "Payload too large (max 2MB)" }, { status: 413 });
      }
      const ct = (request.headers.get("Content-Type") || "").toLowerCase();
      let parsed: { name: string; phone: string; normalized: string }[] = [];
      if (ct.includes("application/json")) {
        const body = (await request.json().catch(() => null)) as
          | { contacts?: { name?: string; phone?: string }[]; text?: string }
          | { name?: string; phone?: string }[]
          | null;
        if (body && !Array.isArray(body) && typeof body.text === "string") {
          parsed = parseVcf(body.text);
        } else {
          const rawList = Array.isArray(body) ? body : body && Array.isArray(body.contacts) ? body.contacts : [];
          parsed = rawList
            .map((c) => {
              const name = String(c.name || "").trim();
              const phone = String(c.phone || "").trim();
              const digits = phone.replace(/\D/g, "");
              const normalized = digits.length >= 10 ? digits.slice(-10) : digits;
              return { name, phone, normalized };
            })
            .filter((c) => c.name && c.normalized.length >= 7);
        }
      } else {
        const vcfText = await request.text();
        parsed = parseVcf(vcfText);
      }
      const imported = await importContacts(env.DB, parsed, apiUser.id);
      await markContactsSynced(env.DB, apiUser.id);
      return Response.json({ ok: true, imported });
    }

    if (path === "/api/messages" && method === "POST") {
      const apiUser = await verifyShortcutApiKey(request, env);
      if (!apiUser) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const len = parseInt(request.headers.get("Content-Length") || "0", 10);
      if (len > 512 * 1024) {
        return Response.json({ error: "Payload too large (max 512KB)" }, { status: 413 });
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
      const stats = await ingestMessages(env.DB, items, apiUser.id);
      const hosted = isHostedInstance(url.hostname);
      let aiPendingCount = 0;
      let targetChats: IncomingMessageInput[] = [];
      let draftDebug = !env.AI
        ? "no_ai_binding"
        : apiUser.auto_draft_enabled !== 1
        ? "disabled"
        : stats.stored <= 0
        ? "no_new_stored"
        : hosted && !isUserProActive(apiUser) && getEffectiveDailyUsage(apiUser) >= DAILY_FREE_AI_LIMIT
        ? "quota_exceeded"
        : "no_eligible_chats";
      try {
      if (
        stats.stored > 0 &&
        apiUser.auto_draft_enabled === 1 &&
        env.AI &&
        (!hosted || isUserProActive(apiUser) || getEffectiveDailyUsage(apiUser) < DAILY_FREE_AI_LIMIT)
      ) {
        const seenChats = new Set<string>();
        const maxParticipants = Math.min(4, Math.max(1, Number(apiUser.auto_draft_max_participants ?? 4) || 4));
        for (const m of items) {
          const body = (m.body || "").trim();
          const title = (m.chat_title || "").trim();
          const recips = (m.recipients || title).trim();
          const sender = (m.sender || title).trim();
          const participants = Math.max(countChatParticipants(recips), countChatParticipants(title));
          const key = title.toLowerCase();
          if (
            m.is_unread &&
            body.length > 0 &&
            body !== "\uFFFC" &&
            participants >= 1 &&
            participants <= maxParticipants &&
            !isShortCodeOrOtp(sender, recips, body) &&
            !seenChats.has(key)
          ) {
            seenChats.add(key);
            targetChats.push(m);
            if (targetChats.length >= 5) break;
          }
        }
        if (targetChats.length > 0 && env.AI) {
          const aiBinding = env.AI;
          const prefs = await getAllPreferences(env.DB, apiUser.id);
          const styleHint = prefs["texting_style"]
            ? `Texting style: ${prefs["texting_style"]}.`
            : "Keep it short, natural, and casual.";
          draftDebug = "ok";
          const draftOne = async (target: IncomingMessageInput) => {
            try {
              const aiRes = await aiBinding.run("@cf/meta/llama-3.1-8b-instruct-fast", {
                messages: [
                  {
                    role: "system",
                    content: `Draft a brief, helpful SMS reply on behalf of the user. ${styleHint} Output ONLY the reply text, no quotes.`,
                  },
                  {
                    role: "user",
                    content: `From ${target.sender || target.chat_title}${
                      target.chat_title && target.sender && target.chat_title !== target.sender
                        ? ` in ${target.chat_title}`
                        : ""
                    }: ${target.body}`,
                  },
                ],
              });
              const draft = (aiRes?.response || "").trim().slice(0, 600);
              if (!draft) {
                draftDebug = "empty_ai_response";
                return;
              }
              const queued = await queueOutboxItem(
                env.DB,
                { ...apiUser, require_approval_default: 1 },
                {
                  recipients: (target.recipients || target.chat_title).trim(),
                  chatTitle: target.chat_title.trim(),
                  body: draft,
                }
              );
              if (queued.ok) {
                await recordAutoDraftUsage(env.DB, apiUser.id, AI_UNITS_PER_DRAFT);
              } else {
                draftDebug = `queue_blocked:${queued.error}`;
              }
            } catch (err) {
              draftDebug = `ai_err:${err instanceof Error ? err.message : String(err)}`;
              console.error("[AUTO_DRAFT_ERR]", draftDebug);
            }
          };

          const remaining = targetChats.slice(1);
          aiPendingCount = remaining.length;
          if (remaining.length > 0) {
            await env.OAUTH_KV.put(`ai_pending:${apiUser.id}`, String(remaining.length), {
              expirationTtl: 60,
            }).catch(() => {});
          }
          // Draft the first message immediately so it pops up right away
          await draftOne(targetChats[0]);
          // Stream remaining chats in the background while the user reads the first one
          if (remaining.length > 0) {
            ctx.waitUntil(
              (async () => {
                let left = remaining.length;
                for (const nextChat of remaining) {
                  await draftOne(nextChat);
                  left -= 1;
                  if (left > 0) {
                    await env.OAUTH_KV.put(`ai_pending:${apiUser.id}`, String(left), { expirationTtl: 60 }).catch(() => {});
                  } else {
                    await env.OAUTH_KV.delete(`ai_pending:${apiUser.id}`).catch(() => {});
                  }
                }
              })()
            );
          }
        }
      }
      } catch (outerErr) {
        draftDebug = `outer_err:${outerErr instanceof Error ? outerErr.message : String(outerErr)}`;
        console.error("[AUTO_DRAFT_OUTER_ERR]", draftDebug);
      }
      const debugPayload = JSON.stringify({
        draftDebug,
        stored: stats.stored,
        duplicates: stats.duplicates,
        totalItems: items.length,
        targetCount: targetChats.length,
        targets: targetChats.map((t) => ({ chat: t.chat_title, sender: t.sender, recips: t.recipients, unread: t.is_unread })),
        at: new Date().toISOString(),
      });
      await env.DB.prepare(
        "INSERT INTO user_preferences (user_id, key, value, updated_at) VALUES (?, 'last_draft_debug', ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      )
        .bind(apiUser.id, debugPayload, Date.now())
        .run()
        .catch(() => {});
      return Response.json({
        ok: true,
        processed: true,
        ...stats,
        ai_pending: aiPendingCount,
        draft_debug: draftDebug,
      });
    }

    const appSecret = await getAppSessionSecret(env.DB);
    const totalUsers = await getUserCount(env.DB);

    // ── 2. First-Run Setup (/setup) ──
    if (totalUsers === 0) {
      if (path === "/setup" && method === "POST") {
        const ip = getClientIp(request);
        if (!(await checkAuthRateLimit(env.DB, ip))) {
          return renderSetupPage("Too many attempts. Try again in 15 minutes.");
        }
        const form = await request.formData();
        const username = String(form.get("username") || "admin").trim().toLowerCase();
        const password = String(form.get("password") || "");
        const confirm = String(form.get("confirm") || "");
        if (!/^[a-z0-9._-]{2,40}$/.test(username)) {
          return renderSetupPage("Username must be 2–40 letters, numbers, dots, dashes, or underscores.");
        }
        if (password.length < 10) return renderSetupPage("Password must be at least 10 characters.");
        if (password !== confirm) return renderSetupPage("Passwords do not match.");

        const { hash: pwHash, salt: pwSalt } = await hashPassword(password);
        const sessionSecret = randomHex(32);
        const { key: apiKey, prefixDisplay } = generateApiKey("ath");
        const apiKeyHash = await sha256Hex(apiKey);

        const ins = await env.DB.prepare(
          `INSERT INTO users
            (username, password_hash, password_salt, session_secret, api_key_hash, api_key_prefix, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(username, pwHash, pwSalt, sessionSecret, apiKeyHash, prefixDisplay, Date.now())
          .run();

        const newId = Number(ins.meta?.last_row_id || 1);
        await resetAuthRateLimit(env.DB, ip);
        const cookie = await createSessionCookie(appSecret, newId);
        const resp = await renderDashboardFromState(env, url.origin, newId, appSecret, {
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

    // ── 3. Sign Up / Login / Logout ──
    if (path === "/signup" && method === "GET") {
      return renderSignupPage();
    }

    if (path === "/signup" && method === "POST") {
      const ip = getClientIp(request);
      if (!(await checkAuthRateLimit(env.DB, `signup:${ip}`, 5, 60 * 60 * 1000))) {
        return renderSignupPage("Too many signups from this network. Try again in an hour.");
      }
      const form = await request.formData();
      if (String(form.get("website") || "").trim() !== "") {
        return renderSignupPage("Unable to process signup.");
      }
      const email = String(form.get("email") || form.get("username") || "").trim().toLowerCase();
      const password = String(form.get("password") || "");
      const confirm = String(form.get("confirm") || "");
      if (!isValidEmail(email)) {
        return renderSignupPage("Please enter a valid email address.");
      }
      if (password.length < 10) return renderSignupPage("Password must be at least 10 characters.");
      if (password !== confirm) return renderSignupPage("Passwords do not match.");

      const existing = await getUserByUsername(env.DB, email);
      if (existing) {
        return renderSignupPage("An account with that email already exists. Try Sign In instead.");
      }

      const { hash: pwHash, salt: pwSalt } = await hashPassword(password);
      const sessionSecret = randomHex(32);
      const { key: apiKey, prefixDisplay } = generateApiKey("ath");
      const apiKeyHash = await sha256Hex(apiKey);

      const now = Date.now();
      const ins = await env.DB.prepare(
        `INSERT INTO users
          (username, email, password_hash, password_salt, session_secret, api_key_hash, api_key_prefix, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(email, email, pwHash, pwSalt, sessionSecret, apiKeyHash, prefixDisplay, now)
        .run();

      const newId = Number(ins.meta?.last_row_id || 1);
      await recordSignupLog(env.DB, newId, email, now);
      console.log(JSON.stringify({ event: "signup", userId: newId, email, signedUpAt: new Date(now).toISOString() }));
      if (isHostedInstance(url.origin)) {
        try {
          await fetch("https://elevatedcleaning.page/api/ai-text-hub/signup-log", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(env.SIGNUP_LOG_SECRET ? { "X-Signup-Log-Secret": env.SIGNUP_LOG_SECRET } : {}),
            },
            body: JSON.stringify({ userId: newId, email, signedUpAt: now }),
          });
        } catch {
          // Non-fatal: D1 signup_logs and Workers Logs still have it
        }
      }
      await resetAuthRateLimit(env.DB, ip);
      const cookie = await createSessionCookie(appSecret, newId);
      const resp = await renderDashboardFromState(env, url.origin, newId, appSecret, {
        freshApiKey: apiKey,
        notice: "Account created! Save your Shortcut API Key below before leaving this page.",
      });
      resp.headers.set("Set-Cookie", cookie);
      return resp;
    }

    if (path === "/login" && method === "GET") {
      return renderLoginPage(undefined, url.searchParams.get("next") || "/dashboard");
    }

    if (path === "/login" && method === "POST") {
      const ip = getClientIp(request);
      const form = await request.formData();
      const identifier = String(form.get("email") || form.get("username") || "").trim().toLowerCase();
      const password = String(form.get("password") || "");
      const next = String(form.get("next") || "/dashboard");
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

      const ipOk = await checkAuthRateLimit(env.DB, ip);
      const acctOk = identifier ? await checkAuthRateLimit(env.DB, `acct:${identifier}`) : true;
      if (!ipOk || !acctOk) {
        return renderLoginPage("Too many failed attempts. Wait 15 minutes.", safeNext);
      }

      const user = await getUserByUsername(env.DB, identifier);
      if (!user || !(await verifyPassword(password, user.password_hash, user.password_salt))) {
        return renderLoginPage("Incorrect email or password.", safeNext);
      }
      await resetAuthRateLimit(env.DB, ip);
      if (identifier) await resetAuthRateLimit(env.DB, `acct:${identifier}`);
      const cookie = await createSessionCookie(appSecret, user.id);
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
      const csrfToken = await createCsrfToken(appSecret);
      const authNonce = randomHex(16);
      await env.OAUTH_KV.put(`auth_req:${authNonce}`, JSON.stringify(oauthReq), {
        expirationTtl: 1800,
      });
      const resp = renderOAuthAuthorizePage({
        clientName: clientInfo?.clientName || oauthReq.clientId,
        csrfToken,
        authNonce,
      });
      const headers = new Headers(resp.headers);
      headers.set("Cache-Control", "no-store");
      return new Response(resp.body, { status: resp.status, headers });
    }

    if (path === "/authorize" && method === "POST") {
      const ip = getClientIp(request);
      const form = await request.formData();
      const csrf = String(form.get("csrf") || "");
      const authNonce = String(form.get("auth_nonce") || "");
      const identifier = String(form.get("email") || form.get("username") || "").trim().toLowerCase();
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

      if (!(await verifyCsrfToken(csrf, appSecret))) {
        return renderOAuthAuthorizePage({
          clientName,
          csrfToken: await createCsrfToken(appSecret),
          authNonce,
          error: "Session expired. Please try again.",
        });
      }
      const ipOk = await checkAuthRateLimit(env.DB, ip);
      const acctOk = identifier ? await checkAuthRateLimit(env.DB, `acct:${identifier}`) : true;
      if (!ipOk || !acctOk) {
        return renderOAuthAuthorizePage({
          clientName,
          csrfToken: await createCsrfToken(appSecret),
          authNonce,
          error: "Too many failed attempts. Wait 15 minutes.",
        });
      }
      const user = await getUserByUsername(env.DB, identifier);
      if (!user || !(await verifyPassword(password, user.password_hash, user.password_salt))) {
        return renderOAuthAuthorizePage({
          clientName,
          csrfToken: await createCsrfToken(appSecret),
          authNonce,
          error: "Incorrect email or password.",
        });
      }

      await resetAuthRateLimit(env.DB, ip);
      if (identifier) await resetAuthRateLimit(env.DB, `acct:${identifier}`);
      const finalScopes = scopes.length > 0 ? scopes : ["messages:read", "contacts:read"];
      const userKey = oauthUserKey(user.id);
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId: userKey,
        metadata: { label: clientName },
        scope: finalScopes,
        props: {
          sub: user.username || userKey,
          userId: user.id,
          scopes: finalScopes,
          clientLabel: clientName,
        } satisfies OAuthUserProps,
      });
      await env.OAUTH_KV.delete(`auth_req:${authNonce}`).catch(() => {});
      const safeRedirJson = JSON.stringify(redirectTo);
      const safeRedirAttr = redirectTo.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      return new Response(
        `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Authorized — AI Text Hub</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#0a0a0a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center}a{display:inline-block;margin-top:14px;padding:10px 18px;background:#d94e00;color:#fff;text-decoration:none;font-weight:700}</style></head><body><div><h2>Authorized!</h2><p>Returning to ${clientName.replace(/</g, "&lt;")}...</p><a href="${safeRedirAttr}">Continue &rarr;</a></div><script>window.location.replace(${safeRedirJson});</script></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
      );
    }

    // ── 5. Authenticated Dashboard & Management Routes ──
    const sessionUserId = await getSessionUserId(request, appSecret);
    if (!sessionUserId) {
      if (path === "/") {
        return Response.redirect(`${url.origin}/signup`, 302);
      }
      return Response.redirect(`${url.origin}/login?next=${encodeURIComponent(path)}`, 302);
    }
    const activeUser = await getConfig(env.DB, sessionUserId);
    if (!activeUser) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/login", "Set-Cookie": clearSessionCookie() },
      });
    }

    if (path === "/api/admin/signups.log" && method === "GET") {
      if (sessionUserId !== 1) {
        return new Response("Forbidden", { status: 403 });
      }
      const rows = await listSignupLogs(env.DB, 2000);
      const lines = rows
        .map((r) => `${new Date(r.signed_up_at).toISOString()}\t${r.email}\tuser_id=${r.user_id}`)
        .join("\n");
      return new Response(lines ? `${lines}\n` : "", {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'inline; filename="signups.log"',
          "Cache-Control": "no-store",
        },
      });
    }

    if (path === "/api/contacts/upload" && method === "POST") {
      const csrf = request.headers.get("X-CSRF-Token") || "";
      if (!(await verifyCsrfToken(csrf, appSecret))) {
        return Response.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
      }
      const vcfText = await request.text();
      const parsed = parseVcf(vcfText);
      const imported = await importContacts(env.DB, parsed, activeUser.id);
      await markContactsSynced(env.DB, activeUser.id);
      return Response.json({ ok: true, imported });
    }

    if (path === "/api/contacts/add" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), appSecret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const name = String(form.get("name") || "").trim();
      const phone = String(form.get("phone") || "").trim();
      const digits = phone.replace(/\D/g, "");
      const normalized = digits.length >= 10 ? digits.slice(-10) : digits;
      if (!name || normalized.length < 7) {
        return renderDashboardFromState(env, url.origin, activeUser.id, appSecret, {
          notice: "Please enter both a contact name and a valid phone number.",
        });
      }
      await importContacts(env.DB, [{ name, phone, normalized }], activeUser.id);
      await markContactsSynced(env.DB, activeUser.id);
      return renderDashboardFromState(env, url.origin, activeUser.id, appSecret, {
        notice: `Saved contact "${name}" (${phone}).`,
      });
    }

    if (path === "/api/rotate-key" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), appSecret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const { key, prefixDisplay } = generateApiKey("ath");
      const hash = await sha256Hex(key);
      await env.DB.prepare("UPDATE users SET api_key_hash = ?, api_key_prefix = ? WHERE id = ?")
        .bind(hash, prefixDisplay, activeUser.id)
        .run();
      return renderDashboardFromState(env, url.origin, activeUser.id, appSecret, {
        freshApiKey: key,
        notice: "Shortcut API Key rotated. Update your iPhone Shortcut with the new key below.",
      });
    }

    if (path === "/api/mcp-bearer" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), appSecret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const action = String(form.get("action") || "");
      if (action === "disable") {
        await env.DB.prepare("UPDATE users SET mcp_bearer_enabled = 0, mcp_bearer_hash = NULL WHERE id = ?")
          .bind(activeUser.id)
          .run();
        return Response.redirect(`${url.origin}/dashboard`, 302);
      }
      const { key } = generateApiKey("ath_mcp");
      const hash = await sha256Hex(key);
      await env.DB.prepare("UPDATE users SET mcp_bearer_enabled = 1, mcp_bearer_hash = ? WHERE id = ?")
        .bind(hash, activeUser.id)
        .run();
      return renderDashboardFromState(env, url.origin, activeUser.id, appSecret, {
        freshMcpBearer: key,
        notice: "Static MCP Bearer token enabled for CLI / Grok API clients.",
      });
    }

    if (path === "/api/auto-draft/toggle" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), appSecret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const action = String(form.get("action") || "").trim();
      const rawMax = parseInt(String(form.get("max_participants") || ""), 10);
      const maxP = Number.isFinite(rawMax) ? Math.min(4, Math.max(1, rawMax)) : Math.min(4, Math.max(1, activeUser.auto_draft_max_participants ?? 4));
      if (action === "update_max") {
        await env.DB.prepare("UPDATE users SET auto_draft_max_participants = ? WHERE id = ?")
          .bind(maxP, activeUser.id)
          .run();
        return renderDashboardFromState(env, url.origin, activeUser.id, appSecret, {
          notice: `Auto-Draft now replies to chats with 1–${maxP} people.`,
        });
      }
      const nextVal = activeUser.auto_draft_enabled === 1 ? 0 : 1;
      await env.DB.prepare("UPDATE users SET auto_draft_enabled = ?, auto_draft_max_participants = ? WHERE id = ?")
        .bind(nextVal, maxP, activeUser.id)
        .run();
      return renderDashboardFromState(env, url.origin, activeUser.id, appSecret, {
        notice:
          nextVal === 1
            ? `Background Auto-Draft AI enabled for chats with 1–${maxP} people.`
            : "Background Auto-Draft AI paused.",
      });
    }

    if (path === "/upgrade-success" && method === "GET") {
      const sessionId = url.searchParams.get("session_id") || "";
      const userParam = (url.searchParams.get("user") || "").trim().toLowerCase();
      if (sessionId && userParam && userParam === (activeUser.username || "admin").toLowerCase()) {
        try {
          const verifyRes = await fetch(
            `https://elevatedcleaning.page/api/ai-text-hub/verify-upgrade?session_id=${encodeURIComponent(sessionId)}&user=${encodeURIComponent(userParam)}`
          );
          const data = (await verifyRes.json()) as { ok?: boolean };
          if (data?.ok) {
            const firstClaim = await claimStripeSessionOnce(env.DB, sessionId, activeUser.id);
            if (!firstClaim) {
              return renderDashboardFromState(env, url.origin, activeUser.id, appSecret, {
                notice: "This checkout session was already redeemed.",
              });
            }
            const proUntil = Date.now() + 366 * 24 * 60 * 60 * 1000;
            await env.DB.prepare("UPDATE users SET is_pro = 1, pro_until = ?, auto_draft_enabled = 1 WHERE id = ?")
              .bind(proUntil, activeUser.id)
              .run();
            return renderDashboardFromState(env, url.origin, activeUser.id, appSecret, {
              notice: "Unlimited Auto-Draft AI ($12/yr) is now active on your account!",
            });
          }
        } catch {}
      }
      return renderDashboardFromState(env, url.origin, activeUser.id, appSecret, {
        notice: "Could not verify upgrade payment yet. Please refresh in a moment.",
      });
    }

    if (path === "/api/settings" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), appSecret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const cap = Math.min(100, Math.max(1, parseInt(String(form.get("hourly_send_cap") || "10"), 10) || 10));
      const allowOnly = form.get("allowlist_only") === "1" ? 1 : 0;
      const reqApp = form.get("require_approval_default") === "1" ? 1 : 0;
      await env.DB.prepare(
        "UPDATE users SET hourly_send_cap = ?, allowlist_only = ?, require_approval_default = ? WHERE id = ?"
      )
        .bind(cap, allowOnly, reqApp, activeUser.id)
        .run();
      return Response.redirect(`${url.origin}/dashboard`, 302);
    }

    if (path === "/api/allowlist/add" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), appSecret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const targetType = form.get("target_type") === "chat" ? "chat" : "phone";
      const targetValue = String(form.get("target_value") || "").trim();
      const label = String(form.get("label") || "").trim();
      if (targetValue) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO allowlist (user_id, target_type, target_value, label, auto_send, created_at)
           VALUES (?, ?, ?, ?, 1, ?)`
        )
          .bind(activeUser.id, targetType, targetValue, label, Date.now())
          .run();
      }
      return Response.redirect(`${url.origin}/dashboard`, 302);
    }

    if (path === "/api/allowlist/delete" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), appSecret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const id = parseInt(String(form.get("id") || "0"), 10);
      if (id > 0) {
        await env.DB.prepare("DELETE FROM allowlist WHERE id = ? AND user_id = ?")
          .bind(id, activeUser.id)
          .run();
      }
      return Response.redirect(`${url.origin}/dashboard`, 302);
    }

    if (path === "/api/clients/revoke" && method === "POST") {
      const form = await request.formData();
      if (!(await verifyCsrfToken(String(form.get("csrf") || ""), appSecret))) {
        return new Response("Invalid CSRF", { status: 403 });
      }
      const grantId = String(form.get("grantId") || "");
      if (grantId) await env.OAUTH_PROVIDER.revokeGrant(grantId, oauthUserKey(activeUser.id));
      return Response.redirect(`${url.origin}/dashboard`, 302);
    }

    if (path === "/" || path === "/dashboard") {
      return renderDashboardFromState(env, url.origin, activeUser.id, appSecret);
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function renderDashboardFromState(
  env: Env,
  origin: string,
  userId: number,
  appSecret: string,
  extra?: { freshApiKey?: string; freshMcpBearer?: string; notice?: string }
): Promise<Response> {
  const config = (await getConfig(env.DB, userId))!;
  const [contacts, chats, outbox, allowlistRes, grantsRes, csrfToken] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as c FROM contacts WHERE user_id = ?").bind(userId).first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(DISTINCT chat_key) as c FROM messages WHERE user_id = ?").bind(userId).first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) as c FROM outbox WHERE user_id = ?").bind(userId).first<{ c: number }>(),
    env.DB.prepare("SELECT * FROM allowlist WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all<AllowlistRow>(),
    env.OAUTH_PROVIDER.listUserGrants(oauthUserKey(userId)),
    createCsrfToken(appSecret),
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
          const userId = props?.userId ?? 1;
          return handleMcpRequest(request, env, ctx, scopes, userId);
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
    if (url.pathname === "/mcp") {
      const bearerUser = await verifyMcpBearerFallback(request, env);
      if (bearerUser) {
        return handleMcpRequest(request, env, ctx, ["*"], bearerUser.id);
      }
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
