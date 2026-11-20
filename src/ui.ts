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
  --bg: #eef2f7;
  --ink: #0f172a;
  --muted: #475569;
  --glass: rgba(255, 255, 255, 0.72);
  --glass-border: rgba(15, 23, 42, 0.10);
  --accent: #0284c7;
  --accent-2: #4f46e5;
  --danger: #dc2626;
  --ok: #059669;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b101b;
    --ink: #f1f5f9;
    --muted: #94a3b8;
    --glass: rgba(22, 30, 48, 0.72);
    --glass-border: rgba(255, 255, 255, 0.12);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(60% 50% at 15% 10%, rgba(14,165,233,0.18), transparent 65%),
    radial-gradient(50% 45% at 85% 20%, rgba(99,102,241,0.16), transparent 65%),
    var(--bg);
  line-height: 1.5;
  padding: 28px 16px 64px;
}
.wrap { max-width: 860px; margin: 0 auto; }
.card {
  position: relative;
  background: var(--glass);
  backdrop-filter: blur(22px) saturate(170%);
  -webkit-backdrop-filter: blur(22px) saturate(170%);
  border: 1px solid var(--glass-border);
  border-radius: 20px;
  padding: 24px;
  margin-bottom: 18px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.45), 0 12px 32px rgba(15,23,42,0.08);
}
h1 { margin: 0 0 8px; font-size: 1.65rem; letter-spacing: -0.02em; }
h2 { margin: 0 0 12px; font-size: 1.15rem; }
p { margin: 0 0 12px; color: var(--muted); }
label { display: block; font-weight: 600; font-size: 0.9rem; margin: 12px 0 6px; }
input[type="password"], input[type="text"], input[type="number"], textarea, select {
  width: 100%; padding: 10px 12px; border-radius: 12px;
  border: 1px solid var(--glass-border);
  background: rgba(255,255,255,0.55); color: var(--ink);
  font: inherit;
}
@media (prefers-color-scheme: dark) {
  input[type="password"], input[type="text"], input[type="number"], textarea, select {
    background: rgba(15,23,42,0.55);
  }
}
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-radius: 12px; border: 1px solid var(--glass-border);
  background: var(--glass); color: var(--ink); font-weight: 600;
  cursor: pointer; text-decoration: none; font-size: 0.92rem;
}
.btn-primary {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #fff; border-color: transparent;
}
.btn-danger { color: var(--danger); }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.code-box {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.86rem; padding: 10px 12px; border-radius: 10px;
  background: rgba(15,23,42,0.07); word-break: break-all; flex: 1;
}
@media (prefers-color-scheme: dark) { .code-box { background: rgba(255,255,255,0.07); } }
.banner {
  padding: 12px 14px; border-radius: 12px; margin-bottom: 16px; font-size: 0.92rem;
  border: 1px solid rgba(5,150,105,0.3); background: rgba(5,150,105,0.12);
}
.banner.err { border-color: rgba(220,38,38,0.35); background: rgba(220,38,38,0.12); color: var(--danger); }
.dropzone {
  border: 2px dashed var(--glass-border); border-radius: 16px; padding: 26px;
  text-align: center; cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.dropzone.over { border-color: var(--accent); background: rgba(2,132,199,0.08); }
.grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.pill {
  display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 0.78rem;
  font-weight: 600; background: rgba(2,132,199,0.14); color: var(--accent);
}
`;

function layout(title: string, body: string): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body><div class="wrap">${body}</div></body></html>`,
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
      <h1>Create Your Master Password</h1>
      <p>This Worker is 100% yours. Your password locks this dashboard and acts as your private OAuth 2.1 login when connecting Claude, ChatGPT, or Grok.</p>
      ${error ? `<div class="banner err">${esc(error)}</div>` : ""}
      <form method="POST" action="/setup">
        <label for="password">Master Password (min 10 characters)</label>
        <input id="password" name="password" type="password" minlength="10" required autocomplete="new-password" />
        <label for="confirm">Confirm Password</label>
        <input id="confirm" name="confirm" type="password" minlength="10" required autocomplete="new-password" />
        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">Initialize My Private Hub</button>
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
      <h1>Unlock AI Text Hub</h1>
      <p>Enter your master password to manage your Shortcut key, contacts, and connected AI clients.</p>
      ${error ? `<div class="banner err">${esc(error)}</div>` : ""}
      <form method="POST" action="/login">
        <input type="hidden" name="next" value="${esc(nextUrl)}" />
        <label for="password">Master Password</label>
        <input id="password" name="password" type="password" required autocomplete="current-password" />
        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">Sign In</button>
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
        <label for="password">Master Password</label>
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
        <p style="margin:0">Private self-hosted Worker &middot; ${params.contactCount} contacts &middot; ${params.chatCount} active chats &middot; ${params.pendingOutbox} queued</p>
      </div>
      <form method="POST" action="/logout"><button class="btn" type="submit">Sign Out</button></form>
    </div>

    ${params.notice ? `<div class="banner">${esc(params.notice)}</div>` : ""}

    ${
      params.freshApiKey
        ? `<div class="card" style="border-color:rgba(2,132,199,0.45)">
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
        ? `<div class="card" style="border-color:rgba(99,102,241,0.45)">
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
      <h2>Step 1 &mdash; Your Private Endpoints &amp; Keys</h2>
      <div class="grid-2">
        <div>
          <label>Worker URL (Shortcut Import Question #1)</label>
          <div class="row">
            <div class="code-box" id="workerUrl">${esc(params.origin)}</div>
            <button class="btn" type="button" onclick="copyText('workerUrl')">Copy</button>
          </div>
        </div>
        <div>
          <label>Remote MCP URL (Claude / ChatGPT / Grok)</label>
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
      <h2>Drop Contacts File (.vcf)</h2>
      <p>Export your iPhone/iCloud Contacts as a <code>.vcf</code> file and drop it here. Stored strictly in your private D1 database.</p>
      <div class="dropzone" id="vcfDrop">
        <strong>Drop <code>Contacts.vcf</code> here</strong> or click to browse
        <input type="file" id="vcfInput" accept=".vcf,text/vcard" style="display:none" />
      </div>
      <p id="vcfStatus" style="margin-top:10px;font-weight:600"></p>
    </div>

    <div class="card">
      <h2>Step 3 &mdash; Copy-Paste Chat Starter Prompt</h2>
      <p>After connecting your MCP URL in Claude, ChatGPT, or Grok, paste this short prompt. Your Worker's backend automatically supplies the setup interview questions (name priorities, nicknames, texting style).</p>
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
      <hr style="border:none;border-top:1px solid var(--glass-border);margin:16px 0" />
      <form method="POST" action="/api/mcp-bearer" class="row" style="justify-content:space-between">
        <input type="hidden" name="csrf" value="${esc(params.csrfToken)}" />
        <div style="font-size:.9rem;color:var(--muted)">Optional Static MCP Bearer Fallback (for CLI / Grok API): <strong>${params.config.mcp_bearer_enabled ? "Enabled" : "Disabled"}</strong></div>
        <div class="row">
          <button class="btn" name="action" value="generate" type="submit">Generate / Enable</button>
          ${params.config.mcp_bearer_enabled ? `<button class="btn btn-danger" name="action" value="disable" type="submit">Disable</button>` : ""}
        </div>
      </form>
    </div>

    <script>
      function copyText(id) {
        const el = document.getElementById(id);
        if (!el) return;
        navigator.clipboard.writeText(el.textContent.trim()).then(() => {
          const orig = el.style.outline;
          el.style.outline = '2px solid #0284c7';
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
