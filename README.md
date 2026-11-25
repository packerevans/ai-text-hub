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
   - [Add AI Text Hub iOS Shortcut](https://www.icloud.com/shortcuts/0e68f671c1cd45f49a1f817cbba393ea)
2. Replace the pre-filled URL in Import Question #1 with your own `https://ai-text-hub.<your-subdomain>.workers.dev` URL.
3. Paste your **Shortcut API Key** into Import Question #2.
4. Open **Apple Shortcuts** → **Automation** tab → tap **+**:
   - Choose **App** → select **Messages** → **Is Opened** → tap **Next**.
   - Enable **Run Immediately** and select **AI Text Hub**.
5. Run the Shortcut once (or open **Messages**) to sync your contacts and recent unread texts before connecting your AI.

### 4. Connect Claude, ChatGPT, or Grok
1. Open your AI client's connector settings:
   - **Claude (Free Works):** Settings → Connectors → Add Custom Connector.
   - **ChatGPT (Pro / Team):** Settings → Apps/Plugins → Advanced → turn **Developer Mode ON**, then click **Create App**.
   - **Grok (Paid):** `grok.com/connectors` → New Connector → Custom.
2. Add your Remote MCP URL:
   - `https://ai-text-hub.<your-subdomain>.workers.dev/mcp`
3. Select **OAuth** and sign in on your Worker's `/authorize` screen using your username and password.
4. Use your dashboard's **Open in Claude / ChatGPT / Grok** button (or paste the Starter Prompt) to set your name priorities and texting style.

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
  - The Worker automatically drops 4–6 digit short codes and OTP verification messages before they are stored or exposed to your AI.
- **Prompt-injection defense:**
  - `read_chat` wraps incoming SMS content in `<untrusted_sms_content>` delimiters.
  - Outbound `queue_text` enforces your allowlist and hourly send cap.
- **Minimal retention:**
  - Keeps only the **past 6 messages per chat**.
  - Outbox rows are deleted immediately on `POST /api/outbox/:id/ack`.
