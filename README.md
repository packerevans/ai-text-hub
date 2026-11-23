# AI Text Hub — Self-Hosted Cloudflare Worker

A 100% private, AI Text Automation Hub running on **Cloudflare Workers + D1 + KV**.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/packerevans/ai-text-hub)

[Full Visual Guide & Support](https://elevatedcleaning.page/ai_text_hub.html) · [Buy Me a Coffee](https://elevatedcleaning.page/ai_text_hub.html?donate=1)

---

## Step-by-Step Setup

### 1. Deploy to Cloudflare
1. Click **Deploy to Cloudflare** above.
2. On **Set up your application**:
   - Click **New GitHub connection** or **New GitLab connection** and sign in.
3. If shown **Select a repository**:
   - Click **Clone a public repository via Git URL >** at the bottom.
   - Paste `https://github.com/packerevans/ai-text-hub`.
   - Click **Next →**.
4. Keep the pre-filled defaults:
   - Leave **Create private Git repository** checked.
   - Leave **Project name** as `ai-text-hub`.
   - Leave **KV namespace** on **+ Create new** → `ai-text-hub`.
5. Click **Deploy** and wait ~1 minute until **Deploying ✓** turns green.

### 2. Enable Your Worker URL & Create Account
1. In Cloudflare, click the **Domains** tab at the top.
2. Toggle **ON** the **Production** `workers.dev` switch:
   - Leave **Preview** turned **OFF**.
3. Open your new `https://ai-text-hub.<your-subdomain>.workers.dev` URL.
4. Create your username and password (minimum 10 characters).
5. Copy your **Worker URL** and **Shortcut API Key** (`ath_...`).

### 3. Install the iPhone Shortcut
1. Open the iCloud Shortcut on your iPhone:
   - [Add AI Text Hub iOS Shortcut](https://www.icloud.com/shortcuts/8e7b000abbf347aeb54316e2be691d0b)
2. Paste your **Worker URL** into Prompt #1.
3. Paste your **Shortcut API Key** into Prompt #2.
4. Open **Apple Shortcuts** → **Automation** tab → tap **+**:
   - Choose **App** → select **Messages** → **Is Opened**.
   - Enable **Run Immediately**.
   - Select **AI Text Hub** as the action.
5. Contacts sync automatically on first run, every 30 days, and whenever your AI cannot find a contact.

### 4. Connect Claude, ChatGPT, or Grok
1. Open **Settings → Connectors** in Claude, ChatGPT, or Grok.
2. Add your Remote MCP URL:
   - `https://ai-text-hub.<your-subdomain>.workers.dev/mcp`
3. Sign in on your Worker's `/authorize` screen using your username and password.
4. Paste the **Starter Prompt** from your dashboard into a new chat to set your name priorities and texting style.

---

## Local Development

```bash
npm install
npm run typecheck
npm run dev
```

## Security Architecture

- **Separate key handling:**
  - iOS Shortcut uses a dedicated revocable `Authorization: Bearer <ath_...>` key stored as a SHA-256 hash.
  - Remote MCP uses **OAuth 2.1 + PKCE + DCR** via `@cloudflare/workers-oauth-provider` with per-client revocation.
- **2FA protection:**
  - Automatically drops 5–6 digit OTP verification codes before they leave your phone.
- **Prompt-injection defense:**
  - `read_chat` wraps incoming SMS content in `<untrusted_sms_content>` delimiters.
  - Outbound `queue_text` enforces your allowlist and hourly send cap.
- **Minimal retention:**
  - Keeps only the **past 6 messages per chat**.
  - Outbox rows are deleted immediately on `POST /api/outbox/:id/ack`.
