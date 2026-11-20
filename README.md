# AI Text Hub — Self-Hosted Cloudflare Worker

A 100% private, single-user AI Text Automation Hub running on **Cloudflare Workers + D1 + KV** (free tier). Every user deploys their own isolated instance—your texts, contacts, and API keys never touch a shared server.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/packerevans/ai-text-hub)

## 3-Step Setup

1. **Cloudflare & Contacts**
   - Click **Deploy to Cloudflare** to auto-provision your Worker, D1 database, and OAuth KV namespace.
   - Open your deployed `.workers.dev` URL, create your Master Password, copy your **Shortcut API Key** (shown once), and drag-and-drop your exported Contacts `.vcf` file into the dashboard.
2. **iPhone Shortcut**
   - Install the combined **Send → Post** Shortcut: [Add AI Text Hub iOS Shortcut](https://www.icloud.com/shortcuts/27c3140eeb264b6a863f8071ca14bad9) and paste your Worker URL + Shortcut API Key into the 2 Import Questions.
   - Add one iOS Personal Automation: **When App `Messages` is Opened → Run Shortcut**.
3. **Connect Claude, ChatGPT, or Grok**
   - Add `https://<your-worker>.workers.dev/mcp` as a Remote MCP server and sign in with your Master Password (OAuth 2.1).
   - Paste the short starter prompt from your dashboard—your Worker's backend automatically guides the AI to ask your name-priority & texting-style preferences and saves them to D1.

## Local Development

```bash
npm install
npm run typecheck
npm run dev
```

## Security Architecture

- **100% separate key handling:** iOS Shortcut uses a dedicated revocable `Authorization: Bearer <ath_...>` key (stored as SHA-256 hash, verified via `timingSafeEqual`). Remote MCP uses **OAuth 2.1 + PKCE + DCR** (`@cloudflare/workers-oauth-provider`) with per-client revocation.
- **2FA protection:** Automatically drops 4–6 digit short codes and OTP verification messages.
- **Prompt-injection defense:** `read_chat` wraps incoming SMS content in `<untrusted_sms_content>` delimiters; outbound `queue_text` enforces allowlist + hourly send cap.
- **Minimal retention:** Strictly keeps only the **past 6 messages per chat**; outbox rows are deleted immediately on `POST /api/outbox/:id/ack`.
