import type { AllowlistRow, ConfigRow } from "./types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BASE_CSS = `
:root {
  --bg: #ffffff;
  --surface: #f7f7f7;
  --surface-2: #efefef;
  --ink: #0a0a0a;
  --muted: #525252;
  --border: #dcdcdc;
  --border-strong: #0a0a0a;
  --accent: #d94e00;
  --accent-hover: #b84000;
  --accent-tint: rgba(217, 78, 0, 0.08);
  --accent-border: rgba(217, 78, 0, 0.45);
  --grid-line: #e8e8e8;
  --danger: #dc2626;
  --ok: #15803d;
}
@media (prefers-color-scheme: dark) {
  /* Intentionally light/white by default; toggled via [data-theme="dark"] */
}
[data-theme="dark"] {
  --bg: #0a0a0a;
  --surface: #121212;
  --surface-2: #1a1a1a;
  --ink: #ffffff;
  --muted: #a3a3a3;
  --border: #262626;
  --border-strong: #ffffff;
  --accent: #e05200;
  --accent-hover: #ff620a;
  --accent-tint: rgba(224, 82, 0, 0.14);
  --accent-border: rgba(224, 82, 0, 0.55);
  --grid-line: rgba(255, 255, 255, 0.04);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
  background-color: var(--bg);
  background-image:
    linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
  background-size: 48px 48px;
  line-height: 1.55;
  padding: 32px 16px 64px;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 860px; margin: 0 auto; }
.card {
  position: relative;
  background: var(--bg);
  border: 1px solid var(--border);
  border-top: 3px solid var(--ink);
  border-radius: 0;
  padding: 24px;
  margin-bottom: 18px;
}
h1 { margin: 8px 0 8px; font-size: 1.65rem; font-weight: 800; letter-spacing: -0.025em; }
h2 { margin: 0 0 12px; font-size: 1.15rem; font-weight: 800; letter-spacing: -0.015em; }
p { margin: 0 0 12px; color: var(--muted); }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.88em;
  padding: 1px 5px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
label { display: block; font-weight: 700; font-size: 0.88rem; margin: 12px 0 6px; }
input[type="password"], input[type="text"], input[type="number"], textarea, select {
  width: 100%; padding: 10px 12px; border-radius: 0;
  border: 1px solid var(--border);
  background: var(--surface); color: var(--ink);
  font: inherit;
}
input:focus, textarea:focus, select:focus {
  outline: none;
  border-color: var(--accent);
}
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 18px; border-radius: 0; border: 1px solid var(--border);
  background: var(--bg); color: var(--ink); font-weight: 700;
  cursor: pointer; text-decoration: none; font-size: 0.9rem;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.btn:hover { border-color: var(--border-strong); background: var(--surface); }
.btn-primary {
  background: var(--accent);
  color: #fff; border-color: var(--accent);
}
.btn-primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
.btn-danger { color: var(--danger); border-color: rgba(220, 38, 38, 0.35); }
.btn-danger:hover { border-color: var(--danger); }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.code-box {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85rem; padding: 10px 12px; border-radius: 0;
  border: 1px solid var(--border);
  background: var(--surface); word-break: break-all; flex: 1;
}
.banner {
  padding: 12px 14px; border-radius: 0; margin-bottom: 16px; font-size: 0.9rem;
  border: 1px solid rgba(21,128,61,0.35); background: rgba(21,128,61,0.1); color: var(--ok);
}
.banner.err { border-color: rgba(220,38,38,0.4); background: rgba(220,38,38,0.1); color: var(--danger); }
.dropzone {
  border: 2px dashed var(--border); border-radius: 0; padding: 26px;
  background: var(--surface);
  text-align: center; cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.dropzone.over { border-color: var(--accent); background: var(--accent-tint); }
.grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.pill {
  display: inline-block; padding: 3px 10px; border-radius: 0; font-size: 0.74rem;
  font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  background: var(--accent-tint); border: 1px solid var(--accent-border); color: var(--accent);
}
.ca-phone {
  width: 224px; margin: 0 auto; border: 2px solid var(--ink); background: var(--bg);
  padding: 8px; position: relative;
}
.ca-bar {
  display: flex; justify-content: space-between; font-size: 9px; font-weight: 700;
  padding-bottom: 6px; border-bottom: 1px solid var(--border); margin-bottom: 6px;
}
.ca-stage { position: relative; height: 214px; overflow: hidden; font-size: 11px; }
.ca-scene {
  position: absolute; inset: 0; opacity: 0; pointer-events: none;
  display: flex; flex-direction: column; gap: 6px;
}
.ca-s1 { animation: caS1 8s infinite; }
.ca-s2 { animation: caS2 8s infinite; }
.ca-s3 { animation: caS3 8s infinite; }
.ca-s4 { animation: caS4 8s infinite; }
@keyframes caS1 { 0%,22% { opacity:1; } 25%,100% { opacity:0; } }
@keyframes caS2 { 0%,24% { opacity:0; } 25%,47% { opacity:1; } 50%,100% { opacity:0; } }
@keyframes caS3 { 0%,49% { opacity:0; } 50%,72% { opacity:1; } 75%,100% { opacity:0; } }
@keyframes caS4 { 0%,74% { opacity:0; } 75%,97% { opacity:1; } 100% { opacity:0; } }
.ca-home-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; padding-top: 8px; }
.ca-app {
  border: 1px solid var(--border); background: var(--surface); padding: 8px 4px;
  text-align: center; font-size: 9px; font-weight: 700; position: relative;
}
.ca-app.focus { border-color: var(--accent); background: var(--accent-tint); color: var(--accent); }
.ca-nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 6px; border: 1px solid var(--border); background: var(--surface); font-weight: 800;
}
.ca-ham {
  display: inline-flex; flex-direction: column; gap: 2px; padding: 3px 4px;
  border: 1px solid var(--accent); background: var(--accent-tint); position: relative;
}
.ca-ham span { display: block; width: 12px; height: 2px; background: var(--accent); }
.ca-row {
  padding: 6px 8px; border: 1px solid var(--border); background: var(--bg);
  display: flex; justify-content: space-between; align-items: center; font-size: 10.5px;
}
.ca-row.held {
  border-color: var(--accent); background: var(--accent-tint); font-weight: 800;
  transform: scale(0.98);
}
.ca-menu {
  border: 1px solid var(--ink); background: var(--bg); margin-top: 2px;
  box-shadow: 0 8px 20px rgba(0,0,0,0.16);
}
.ca-menu-item {
  padding: 7px 10px; font-size: 10.5px; font-weight: 700; border-bottom: 1px solid var(--border);
  display: flex; justify-content: space-between;
}
.ca-menu-item:last-child { border-bottom: 0; }
.ca-menu-item.export { background: var(--accent); color: #fff; position: relative; }
.ca-tap {
  position: absolute; width: 14px; height: 14px; border-radius: 50%;
  background: rgba(217,78,0,0.9); border: 2px solid #fff;
  box-shadow: 0 0 0 4px rgba(217,78,0,0.28);
  animation: caPulse 1s ease-in-out infinite;
}
@keyframes caPulse { 0%,100% { transform: scale(0.9); } 50% { transform: scale(1.18); } }
.ca-caption {
  margin-top: auto; font-size: 9.5px; font-weight: 700; text-align: center;
  padding: 4px; background: var(--surface); border: 1px solid var(--border); color: var(--muted);
}
`;

const CONTACTS_ANIM_HTML = `
<div class="ca-phone" aria-label="Animated guide: Export Contacts from iPhone">
  <div class="ca-bar"><span>9:41</span><span>Contacts Export</span><span>5G</span></div>
  <div class="ca-stage">
    <div class="ca-scene ca-s1">
      <div class="ca-home-grid">
        <div class="ca-app">Phone</div>
        <div class="ca-app focus">Contacts<span class="ca-tap" style="right:4px;bottom:4px;"></span></div>
        <div class="ca-app">Messages</div>
        <div class="ca-app">Safari</div>
        <div class="ca-app">Files</div>
        <div class="ca-app">Settings</div>
      </div>
      <div class="ca-caption">1. Tap the Contacts app</div>
    </div>
    <div class="ca-scene ca-s2">
      <div class="ca-nav">
        <span class="ca-ham"><span></span><span></span><span></span><span class="ca-tap" style="left:6px;top:4px;"></span></span>
        <span>All Contacts</span>
        <span>+</span>
      </div>
      <div class="ca-row"><span>Alex Smith</span><span style="opacity:.5;">›</span></div>
      <div class="ca-row"><span>Cody Miller</span><span style="opacity:.5;">›</span></div>
      <div class="ca-row"><span>Mom</span><span style="opacity:.5;">›</span></div>
      <div class="ca-row"><span>Sarah Jones</span><span style="opacity:.5;">›</span></div>
      <div class="ca-caption">2. Tap the 3 bars at top-left</div>
    </div>
    <div class="ca-scene ca-s3">
      <div class="ca-nav"><span>Lists</span><span style="font-weight:400;opacity:.6;">Edit</span></div>
      <div class="ca-row held" style="position:relative;">
        <span>All Contacts</span><span>142</span>
        <span class="ca-tap" style="left:48%;top:22%;"></span>
      </div>
      <div class="ca-row"><span>iCloud</span><span>142</span></div>
      <div class="ca-row"><span>Gmail</span><span>24</span></div>
      <div class="ca-caption">3. Press &amp; hold All Contacts</div>
    </div>
    <div class="ca-scene ca-s4">
      <div class="ca-nav"><span>Lists</span><span style="font-weight:400;opacity:.6;">Edit</span></div>
      <div class="ca-row held"><span>All Contacts</span><span>142</span></div>
      <div class="ca-menu">
        <div class="ca-menu-item export"><span>Export</span><span>&rarr;<span class="ca-tap" style="right:18px;top:6px;"></span></span></div>
        <div class="ca-menu-item"><span>Email All</span><span></span></div>
      </div>
      <div class="ca-caption">4. Tap Export &rarr; Save to Files</div>
    </div>
  </div>
</div>`;

const LOGO_SVG = `<svg width="24" height="24" viewBox="0 0 128 128" fill="none" aria-hidden="true"><path d="M12 20H116V88H56L26 114V88H12V20Z" fill="#D94E00"/><rect x="26" y="34" width="76" height="40" fill="#FFFFFF"/><rect x="36" y="45" width="32" height="6" fill="#0A0A0A"/><rect x="36" y="57" width="56" height="6" fill="#D94E00"/><rect x="76" y="45" width="16" height="6" fill="#0A0A0A"/></svg>`;

function layout(title: string, body: string): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><!-- Made by Packer Evans --><style>${BASE_CSS}</style></head><body><div class="wrap"><header style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;margin-bottom:20px;background:var(--bg);border:1px solid var(--border);gap:10px;flex-wrap:wrap;"><div style="display:flex;align-items:center;gap:10px;font-weight:800;font-size:0.95rem;letter-spacing:-0.01em;">${LOGO_SVG}<span>AI Text Hub</span></div><div style="display:flex;align-items:center;gap:8px;"><a href="https://elevatedcleaning.page/ai_text_hub.html?donate=1" target="_blank" rel="noopener" class="btn" style="padding:6px 12px;font-size:0.82rem;">Buy Me a Coffee</a><button id="themeToggle" class="btn" type="button" style="padding:6px 10px;font-size:0.85rem;" aria-label="Toggle theme">☾</button></div></header>${body}<div style="margin-top:24px;text-align:right;font-size:11px;opacity:0.42;color:var(--muted);">Made by Packer Evans</div></div><script>(function(){var r=document.documentElement,b=document.getElementById('themeToggle');function a(t){r.setAttribute('data-theme',t);if(b)b.textContent=t==='dark'?'☀':'☾';try{localStorage.setItem('athWorkerTheme',t)}catch{}}var s=null;try{s=localStorage.getItem('athWorkerTheme')}catch{}a(s==='dark'?'dark':'light');if(b)b.addEventListener('click',function(){a(r.getAttribute('data-theme')==='dark'?'light':'dark')});})();</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      },
    }
  );
}

export function renderSetupPage(error?: string): Response {
  return layout(
    "Setup — AI Text Hub",
    `
    <div class="card">
      <span class="pill">First-Run Setup</span>
      <h1>Create Your Hub Account</h1>
      <ul style="margin:0 0 14px 18px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
        <li>This Worker runs inside your own Cloudflare account.</li>
        <li>Your username and password lock this dashboard.</li>
        <li>They also act as your OAuth 2.1 login for Claude, ChatGPT, or Grok.</li>
      </ul>
      ${error ? `<div class="banner err">${esc(error)}</div>` : ""}
      <form method="POST" action="/setup">
        <label for="username">Username</label>
        <input id="username" name="username" type="text" value="admin" minlength="2" maxlength="40" required autocomplete="username" />
        <label for="password">Password (min 10 characters)</label>
        <input id="password" name="password" type="password" minlength="10" required autocomplete="new-password" />
        <label for="confirm">Confirm Password</label>
        <input id="confirm" name="confirm" type="password" minlength="10" required autocomplete="new-password" />
        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">Initialize Hub</button>
        </div>
      </form>
    </div>
    `
  );
}

export function renderSignupPage(error?: string): Response {
  return layout(
    "Create Account — AI Text Hub",
    `
    <div class="card" style="max-width:480px;margin:32px auto;">
      <span class="pill">30-Second Setup</span>
      <h1>Create Your Free Account</h1>
      <ul style="margin:0 0 14px 18px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
        <li>Pick a username and password.</li>
        <li>You will immediately get your private Shortcut API Key and MCP URL.</li>
      </ul>
      ${error ? `<div class="banner err">${esc(error)}</div>` : ""}
      <form method="POST" action="/signup">
        <label for="username">Username</label>
        <input id="username" name="username" type="text" minlength="2" maxlength="40" placeholder="e.g. alex" required autocomplete="username" />
        <label for="password">Password (min 10 characters)</label>
        <input id="password" name="password" type="password" minlength="10" required autocomplete="new-password" />
        <label for="confirm">Confirm Password</label>
        <input id="confirm" name="confirm" type="password" minlength="10" required autocomplete="new-password" />
        <div class="row" style="margin-top:16px;justify-content:space-between;">
          <button class="btn btn-primary" type="submit">Create Account</button>
          <a href="/login" style="font-size:0.88rem;color:var(--accent);font-weight:700;text-decoration:none;">Already have an account? Sign In &rarr;</a>
        </div>
      </form>
    </div>
    `
  );
}

export function renderLoginPage(error?: string, nextUrl = "/dashboard"): Response {
  return layout(
    "Sign In — AI Text Hub",
    `
    <div class="card" style="max-width:460px;margin:48px auto;">
      <h1>Sign In to AI Text Hub</h1>
      <p>Enter your username and password to manage your Shortcut key, contacts, and connected AI clients.</p>
      ${error ? `<div class="banner err">${esc(error)}</div>` : ""}
      <form method="POST" action="/login">
        <input type="hidden" name="next" value="${esc(nextUrl)}" />
        <label for="username">Username</label>
        <input id="username" name="username" type="text" placeholder="admin or your username" required autocomplete="username" />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required autocomplete="current-password" />
        <div class="row" style="margin-top:16px;justify-content:space-between;">
          <button class="btn btn-primary" type="submit">Sign In</button>
          <a href="/signup" style="font-size:0.88rem;color:var(--accent);font-weight:700;text-decoration:none;">New here? Create Account &rarr;</a>
        </div>
      </form>
    </div>
    `
  );
}

export function renderOAuthAuthorizePage(params: {
  clientName: string;
  csrfToken: string;
  authNonce: string;
  error?: string;
}): Response {
  return layout(
    "Authorize AI Client — AI Text Hub",
    `
    <div class="card" style="max-width:520px;margin:32px auto;">
      <span class="pill">OAuth 2.1 Remote MCP</span>
      <h1>Connect ${esc(params.clientName)}</h1>
      <p>Enter your Master Password to grant <strong>${esc(params.clientName)}</strong> scoped access to your private AI Text Hub.</p>
      ${params.error ? `<div class="banner err">${esc(params.error)}</div>` : ""}
      <form method="POST" action="/authorize">
        <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
        <input type="hidden" name="auth_nonce" value="${esc(params.authNonce)}" />
        <label>Permissions</label>
        <label style="font-weight:400"><input type="checkbox" name="scope" value="messages:read" checked /> Read recent chats (past 6 messages)</label>
        <label style="font-weight:400"><input type="checkbox" name="scope" value="contacts:read" checked /> Search synced contacts</label>
        <label style="font-weight:400"><input type="checkbox" name="scope" value="outbox:write" checked /> Queue outbound texts (respects allowlist &amp; hourly cap)</label>
        <label for="username">Username</label>
        <input id="username" name="username" type="text" placeholder="admin or your username" required autocomplete="username" />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required autocomplete="current-password" />
        <div class="row" style="margin-top:18px">
          <button class="btn btn-primary" type="submit">Approve Connection</button>
        </div>
      </form>
    </div>
    `
  );
}

export function renderDashboardPage(params: {
  origin: string;
  config: ConfigRow;
  csrfToken: string;
  contactCount: number;
  chatCount: number;
  pendingOutbox: number;
  allowlist: AllowlistRow[];
  grants: { id: string; clientId: string; scope: string[]; createdAt?: number }[];
  freshApiKey?: string;
  freshMcpBearer?: string;
  notice?: string;
}): Response {
  const mcpUrl = `${params.origin}/mcp`;
  const starterPrompt = `I just connected my private AI Text Hub MCP server. Please run get_onboarding_config to see my setup questions and current preferences, walk me through any unanswered setup questions briefly, and save my preferences.`;

  const allowRows = params.allowlist
    .map(
      (a) => `
      <div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--glass-border)">
        <div><strong>${esc(a.label || a.target_value)}</strong> <span class="pill">${esc(a.target_type)}</span> <span style="color:var(--muted);font-size:.85rem">${esc(a.target_value)}</span></div>
        <form method="POST" action="/api/allowlist/delete" style="margin:0">
          <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
          <input type="hidden" name="id" value="${a.id}" />
          <button class="btn btn-danger" type="submit">Remove</button>
        </form>
      </div>`
    )
    .join("");

  const grantRows =
    params.grants.length === 0
      ? `<p>No AI clients connected yet. Paste your MCP URL into Claude, ChatGPT, or Grok to connect.</p>`
      : params.grants
          .map(
            (g) => `
        <div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--glass-border)">
          <div><strong>${esc(g.clientId)}</strong> <span style="color:var(--muted);font-size:.82rem">(${esc(g.scope.join(", "))})</span></div>
          <form method="POST" action="/api/clients/revoke" style="margin:0">
            <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
            <input type="hidden" name="grantId" value="${esc(g.id)}" />
            <button class="btn btn-danger" type="submit">Revoke</button>
          </form>
        </div>`
          )
          .join("");

  return layout(
    "Dashboard — AI Text Hub",
    `
    <div class="row" style="justify-content:space-between;margin-bottom:14px">
      <div>
        <h1>AI Text Hub</h1>
        <p style="margin:0">Account: <strong>${esc(params.config.username || "admin")}</strong> &middot; ${params.contactCount} contacts &middot; ${params.chatCount} active chats &middot; ${params.pendingOutbox} queued</p>
      </div>
      <form method="POST" action="/logout"><button class="btn" type="submit">Sign Out</button></form>
    </div>

    ${params.notice ? `<div class="banner">${esc(params.notice)}</div>` : ""}

    ${
      params.freshApiKey
        ? `<div class="card" style="border-color:var(--accent-border);border-top-color:var(--accent)">
            <span class="pill">Save Now — Shown Once</span>
            <h2>Your New Shortcut API Key</h2>
            <p>Paste this into your iOS Shortcut's Import Question #2. Only its SHA-256 hash is stored in D1.</p>
            <div class="row">
              <div class="code-box" id="freshKey">${esc(params.freshApiKey)}</div>
              <button class="btn btn-primary" type="button" onclick="copyText('freshKey')">Copy Key</button>
            </div>
          </div>`
        : ""
    }

    ${
      params.freshMcpBearer
        ? `<div class="card" style="border-color:var(--accent-border);border-top-color:var(--accent)">
            <span class="pill">CLI / Grok Bearer Token — Shown Once</span>
            <h2>Your MCP Bearer Fallback Token</h2>
            <div class="row">
              <div class="code-box" id="freshBearer">${esc(params.freshMcpBearer)}</div>
              <button class="btn btn-primary" type="button" onclick="copyText('freshBearer')">Copy Token</button>
            </div>
          </div>`
        : ""
    }

    <div class="card">
      <span class="pill">Automatic</span>
      <h2 style="margin-top:8px;">Contacts Auto-Sync Active</h2>
      <ul style="margin:0 0 0 18px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
        <li><strong>${params.contactCount}</strong> contact(s) currently synced.</li>
        <li>Your iPhone Shortcut automatically uploads contacts on first run, every 30 days, or whenever your AI cannot find a name.</li>
      </ul>
    </div>

    <details style="margin-top:16px;">
      <summary class="btn" style="margin-bottom:14px;">Advanced: Manual Contacts, Endpoints &amp; Settings</summary>

      <div class="card">
        <h2>Manual Contacts Import (.vcf)</h2>
        <div class="grid-2" style="align-items:start;">
          <div>
            <ul style="margin:0 0 14px 18px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
              <li><strong>On iPhone:</strong>
                <ul style="margin:4px 0 0 18px;display:flex;flex-direction:column;gap:2px;">
                  <li>Open the <em>Contacts</em> app.</li>
                  <li>Tap the <em>3 bars</em> (Lists) at the top-left.</li>
                  <li>Press and hold <em>All Contacts</em> &rarr; tap <em>Export</em> &rarr; <em>Save to Files</em>.</li>
                  <li>Tap the box below to upload your <code>.vcf</code> file.</li>
                </ul>
              </li>
            </ul>
            <div class="dropzone" id="vcfDrop">
              <strong>Drop <code>Contacts.vcf</code> here</strong> or tap to pick from Files
              <input type="file" id="vcfInput" accept=".vcf,text/vcard" style="display:none" />
            </div>
            <p id="vcfStatus" style="margin-top:10px;font-weight:600"></p>
            <form method="POST" action="/api/contacts/add" class="row" style="margin-top:12px">
              <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
              <input name="name" type="text" placeholder="Quick add name" required style="flex:1;min-width:130px" />
              <input name="phone" type="text" placeholder="Phone number" required style="flex:1;min-width:140px" />
              <button class="btn" type="submit">Add Contact</button>
            </form>
          </div>
          <div>
            ${CONTACTS_ANIM_HTML}
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Endpoints &amp; Keys</h2>
        <div class="grid-2">
          <div>
            <label>Worker URL</label>
            <div class="row">
              <div class="code-box" id="workerUrl">${esc(params.origin)}</div>
              <button class="btn" type="button" onclick="copyText('workerUrl')">Copy</button>
            </div>
          </div>
          <div>
            <label>Remote MCP URL</label>
            <div class="row">
              <div class="code-box" id="mcpUrl">${esc(mcpUrl)}</div>
              <button class="btn" type="button" onclick="copyText('mcpUrl')">Copy</button>
            </div>
          </div>
        </div>
        <div class="row" style="margin-top:14px;justify-content:space-between">
          <div style="font-size:.9rem;color:var(--muted)">Active Shortcut Key: <code>${esc(params.config.api_key_prefix)}</code></div>
          <form method="POST" action="/api/rotate-key" style="margin:0">
            <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
            <button class="btn" type="submit">Rotate Shortcut API Key</button>
          </form>
        </div>
      </div>

      <div class="card">
        <h2>Chat Starter Prompt</h2>
        <ul style="margin:0 0 14px 18px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
          <li>Connect your MCP URL in Claude, ChatGPT, or Grok.</li>
          <li>Paste this prompt into a new chat to set your name priorities and texting style.</li>
        </ul>
        <div class="row">
          <div class="code-box" id="starterPrompt">${esc(starterPrompt)}</div>
          <button class="btn btn-primary" type="button" onclick="copyText('starterPrompt')">Copy Prompt</button>
        </div>
      </div>

      <div class="card">
        <h2>Guardrails &amp; Allowlist</h2>
        <form method="POST" action="/api/settings" class="grid-2" style="margin-bottom:16px">
          <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
          <div>
            <label for="hourly_send_cap">Max Outbound Texts / Hour</label>
            <input id="hourly_send_cap" name="hourly_send_cap" type="number" min="1" max="100" value="${params.config.hourly_send_cap}" />
          </div>
          <div style="display:flex;flex-direction:column;justify-content:flex-end;gap:6px">
            <label style="margin:0;font-weight:400"><input type="checkbox" name="allowlist_only" value="1" ${params.config.allowlist_only ? "checked" : ""} /> Block sends outside allowlist</label>
            <label style="margin:0;font-weight:400"><input type="checkbox" name="require_approval_default" value="1" ${params.config.require_approval_default ? "checked" : ""} /> Require iPhone tap approval by default</label>
            <button class="btn btn-primary" type="submit" style="margin-top:6px;width:fit-content">Save Guardrails</button>
          </div>
        </form>
        <form method="POST" action="/api/allowlist/add" class="row" style="margin-bottom:12px">
          <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
          <select name="target_type" style="width:auto"><option value="phone">Phone</option><option value="chat">Group / Chat Title</option></select>
          <input name="target_value" type="text" placeholder="+15551234567 or Family Chat" required style="flex:1;min-width:180px" />
          <input name="label" type="text" placeholder="Label (optional)" style="width:160px" />
          <button class="btn" type="submit">Add</button>
        </form>
        ${allowRows || "<p>No allowlist entries yet.</p>"}
      </div>

      <div class="card">
        <h2>Connected AI Clients (OAuth 2.1)</h2>
        ${grantRows}
        <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
        <form method="POST" action="/api/mcp-bearer" class="row" style="justify-content:space-between">
          <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
          <div style="font-size:.9rem;color:var(--muted)">Optional Static MCP Bearer Fallback (for CLI / Grok API): <strong>${params.config.mcp_bearer_enabled ? "Enabled" : "Disabled"}</strong></div>
          <div class="row">
            <button class="btn" name="action" value="generate" type="submit">Generate / Enable</button>
            ${params.config.mcp_bearer_enabled ? `<button class="btn btn-danger" name="action" value="disable" type="submit">Disable</button>` : ""}
          </div>
        </form>
      </div>
    </details>

    <script>
      function copyText(id) {
        const el = document.getElementById(id);
        if (!el) return;
        navigator.clipboard.writeText(el.textContent.trim()).then(() => {
          const orig = el.style.outline;
          el.style.outline = '2px solid var(--accent)';
          setTimeout(() => el.style.outline = orig, 700);
        });
      }
      const drop = document.getElementById('vcfDrop');
      const input = document.getElementById('vcfInput');
      const status = document.getElementById('vcfStatus');
      const csrf = ${JSON.stringify(params.csrfToken)};
      drop.onclick = () => input.click();
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) uploadVcf(e.dataTransfer.files[0]); };
      input.onchange = () => { if (input.files[0]) uploadVcf(input.files[0]); };
      async function uploadVcf(file) {
        status.textContent = 'Uploading & parsing ' + file.name + '...';
        const text = await file.text();
        const res = await fetch('/api/contacts/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'text/vcard', 'X-CSRF-Token': csrf },
          body: text
        });
        const data = await res.json();
        status.textContent = data.ok ? ('Imported ' + data.imported + ' contact number(s)!') : ('Error: ' + (data.error || 'Upload failed'));
      }
    </script>
    `
  );
}
