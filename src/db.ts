import { sha256Hex } from "./crypto";
import type { AllowlistRow, ConfigRow, ContactRow, MessageRow, OutboxRow } from "./types";

const MAX_MESSAGES_PER_CHAT = 6;
const OUTBOX_LEASE_MS = 90_000;

let schemaReady = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      session_secret TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      api_key_prefix TEXT NOT NULL,
      mcp_bearer_hash TEXT,
      mcp_bearer_enabled INTEGER NOT NULL DEFAULT 0,
      hourly_send_cap INTEGER NOT NULL DEFAULT 10,
      require_approval_default INTEGER NOT NULL DEFAULT 0,
      allowlist_only INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      normalized_phone TEXT NOT NULL,
      notes TEXT DEFAULT '',
      updated_at INTEGER NOT NULL,
      UNIQUE(name, normalized_phone)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name COLLATE NOCASE)`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(normalized_phone)`,
    `CREATE TABLE IF NOT EXISTS allowlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK (target_type IN ('phone', 'chat')),
      target_value TEXT NOT NULL,
      label TEXT DEFAULT '',
      auto_send INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      UNIQUE(target_type, target_value)
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_key TEXT NOT NULL,
      chat_title TEXT NOT NULL,
      recipients TEXT NOT NULL,
      sender TEXT NOT NULL,
      body TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      sent_at_label TEXT DEFAULT '',
      is_unread INTEGER NOT NULL DEFAULT 0,
      message_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(chat_key, message_hash)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_key, sent_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at DESC)`,
    `CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      chat_title TEXT DEFAULT '',
      recipients TEXT NOT NULL,
      body TEXT NOT NULL,
      require_approval INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed')),
      claimed_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, created_at ASC)`,
    `CREATE TABLE IF NOT EXISTS send_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sent_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_send_log_time ON send_log(sent_at)`,
    `CREATE TABLE IF NOT EXISTS user_preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS auth_rate_limits (
      ip TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      window_start INTEGER NOT NULL
    )`,
  ];
  await db.batch(stmts.map((sql) => db.prepare(sql)));
  schemaReady = true;
}

export async function getConfig(db: D1Database): Promise<ConfigRow | null> {
  await ensureSchema(db);
  return db.prepare("SELECT * FROM config WHERE id = 1").first<ConfigRow>();
}

export async function checkAuthRateLimit(
  db: D1Database,
  ip: string,
  maxAttempts = 12,
  windowMs = 15 * 60 * 1000
): Promise<boolean> {
  const now = Date.now();
  const row = await db
    .prepare("SELECT attempts, window_start FROM auth_rate_limits WHERE ip = ?")
    .bind(ip)
    .first<{ attempts: number; window_start: number }>();

  if (!row || now - row.window_start > windowMs) {
    await db
      .prepare(
        "INSERT INTO auth_rate_limits (ip, attempts, window_start) VALUES (?, 1, ?) ON CONFLICT(ip) DO UPDATE SET attempts = 1, window_start = ?"
      )
      .bind(ip, now, now)
      .run();
    return true;
  }
  if (row.attempts >= maxAttempts) return false;
  await db
    .prepare("UPDATE auth_rate_limits SET attempts = attempts + 1 WHERE ip = ?")
    .bind(ip)
    .run();
  return true;
}

export async function resetAuthRateLimit(db: D1Database, ip: string): Promise<void> {
  await db.prepare("DELETE FROM auth_rate_limits WHERE ip = ?").bind(ip).run();
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function countChatParticipants(recipientsOrTitle: string): number {
  const raw = (recipientsOrTitle || "").trim();
  if (!raw) return 0;
  // Group chats from iOS Shortcuts arrive as "num1 + num2 + num3" or comma-separated
  if (raw.includes(" + ") || raw.includes(",")) {
    const parts = raw
      .split(/\s+\+\s+|,/)
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.length;
  }
  const phoneMatches = raw.match(/\+?\d[\d\s()-]{6,}\d/g);
  return phoneMatches ? Math.max(1, phoneMatches.length) : 1;
}

export async function resolveFriendlyChatTitle(
  db: D1Database,
  chatTitle: string,
  recipients: string
): Promise<string> {
  const title = chatTitle.trim();
  const hasLetters = /[a-zA-Z]/.test(title);
  if (hasLetters) return title;

  const source = recipients || title;
  const parts = source
    .split(/\s+\+\s+|,/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return title;

  const resolved: string[] = [];
  for (const part of parts) {
    const norm = normalizePhone(part);
    if (norm.length >= 7) {
      const row = await db
        .prepare("SELECT name FROM contacts WHERE normalized_phone = ? LIMIT 1")
        .bind(norm)
        .first<{ name: string }>();
      resolved.push(row ? row.name : part);
    } else {
      resolved.push(part);
    }
  }
  return resolved.join(", ");
}

export function isShortCodeOrOtp(sender: string, recipients: string, body: string): boolean {
  const senderDigits = sender.replace(/\D/g, "");
  const recipDigits = recipients.replace(/\D/g, "");
  const senderIsShortCode = !/[a-z]/i.test(sender) && senderDigits.length >= 4 && senderDigits.length <= 6;
  const recipIsShortCode =
    !/[a-z]/i.test(recipients) &&
    recipDigits.length >= 4 &&
    recipDigits.length <= 6 &&
    !recipients.includes("+") &&
    !recipients.includes(",");
  if (senderIsShortCode || recipIsShortCode) {
    return true;
  }
  const lower = body.toLowerCase();
  const otpPhrase =
    /\b(verification|security|one[- ]time|2fa|two[- ]factor|login|sign[- ]in|auth)\s+(code|pin|passcode)\b/i.test(
      lower
    ) || /\bdo not share this code\b/i.test(lower);
  const hasCodeDigits = /\b\d{4,8}\b/.test(body);
  return otpPhrase && hasCodeDigits;
}

export interface IncomingMessageInput {
  chat_title: string;
  recipients?: string;
  sender?: string;
  body: string;
  sent_at?: string | number;
  is_unread?: boolean;
}

export function parseCustomDelimitedMessages(raw: string): IncomingMessageInput[] {
  const out: IncomingMessageInput[] = [];
  const blocks = raw
    .split(/\)\s*(?=\(<chat)/)
    .map((b) => b.trim().replace(/^\(/, "").replace(/\)$/, ""));
  for (const block of blocks) {
    const chat = (block.match(/<chat\s*=\s*([^>]+)>/) || [])[1]?.trim() || "";
    if (!chat) continue;
    const msgMatch = block.match(/<message\s*=([\s\S]*?)>\s*\n?\s*<date/);
    const body = (msgMatch ? msgMatch[1] : "").trim();
    const date = (block.match(/<date\s*=\s*([^>]+)>/) || [])[1]?.trim() || "";
    const read = (block.match(/<read\s*:\s*(\w+)>/) || [])[1]?.trim() || "";
    const recipients = (block.match(/<recipients\s*=\s*([^>]+)>/) || [])[1]?.trim() || chat;
    if (!body || body === "\uFFFC") continue;
    out.push({
      chat_title: chat,
      recipients,
      sender: chat,
      body,
      sent_at: date,
      is_unread: read.toLowerCase() === "no",
    });
  }
  return out;
}

function parseTimestampMs(val?: string | number): number {
  if (typeof val === "number" && Number.isFinite(val)) {
    return val > 1e12 ? val : val * 1000;
  }
  if (typeof val === "string" && val.trim()) {
    const parsed = Date.parse(val.trim());
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

export async function ingestMessages(
  db: D1Database,
  items: IncomingMessageInput[]
): Promise<{ stored: number; duplicates: number; filtered_otp: number }> {
  await ensureSchema(db);
  const now = Date.now();
  let filteredOtp = 0;

  const validItems: {
    chatKey: string;
    chatTitle: string;
    recipients: string;
    sender: string;
    body: string;
    sentAt: number;
    sentAtLabel: string;
    isUnread: number;
    hash: string;
  }[] = [];

  for (const item of items.slice(0, 100)) {
    const body = (item.body || "").trim();
    const rawChatTitle = (item.chat_title || "").trim();
    if (!body || !rawChatTitle || body === "\uFFFC") continue;
    const recipients = (item.recipients || rawChatTitle).trim();
    const sender = (item.sender || rawChatTitle).trim();
    // Never store or pass group chats with more than 4 people to the AI
    if (countChatParticipants(recipients) > 4 || countChatParticipants(rawChatTitle) > 4) {
      continue;
    }
    if (isShortCodeOrOtp(sender, recipients, body)) {
      filteredOtp++;
      continue;
    }
    const chatTitle = await resolveFriendlyChatTitle(db, rawChatTitle, recipients);
    const sentAt = parseTimestampMs(item.sent_at);
    const sentAtLabel = typeof item.sent_at === "string" ? item.sent_at.trim() : new Date(sentAt).toISOString();
    const chatKey = chatTitle.toLowerCase();
    const hash = await sha256Hex(`${chatKey}|${sentAtLabel}|${body}`);
    validItems.push({
      chatKey,
      chatTitle,
      recipients,
      sender,
      body,
      sentAt,
      sentAtLabel,
      isUnread: item.is_unread ? 1 : 0,
      hash,
    });
  }

  if (validItems.length === 0) {
    return { stored: 0, duplicates: 0, filtered_otp: filteredOtp };
  }

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO messages
      (chat_key, chat_title, recipients, sender, body, sent_at, sent_at_label, is_unread, message_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const results = await db.batch(
    validItems.map((m) =>
      insertStmt.bind(
        m.chatKey,
        m.chatTitle,
        m.recipients,
        m.sender,
        m.body,
        m.sentAt,
        m.sentAtLabel,
        m.isUnread,
        m.hash,
        now
      )
    )
  );

  let stored = 0;
  let duplicates = 0;
  const affectedChats = new Set<string>();
  results.forEach((res, idx) => {
    const changes = res.meta?.changes ?? 0;
    if (changes > 0) {
      stored++;
      affectedChats.add(validItems[idx].chatKey);
    } else {
      duplicates++;
    }
  });

  if (affectedChats.size > 0) {
    const pruneStmt = db.prepare(
      `DELETE FROM messages
       WHERE chat_key = ?
         AND id NOT IN (
           SELECT id FROM messages
           WHERE chat_key = ?
           ORDER BY sent_at DESC, id DESC
           LIMIT ?
         )`
    );
    await db.batch(
      Array.from(affectedChats).map((ck) => pruneStmt.bind(ck, ck, MAX_MESSAGES_PER_CHAT))
    );
  }

  return { stored, duplicates, filtered_otp: filteredOtp };
}

export async function claimPendingOutbox(db: D1Database, limit = 10): Promise<OutboxRow[]> {
  await ensureSchema(db);
  const now = Date.now();
  const leaseCutoff = now - OUTBOX_LEASE_MS;

  // Release any expired leases first
  await db
    .prepare(
      `UPDATE outbox SET status = 'pending', claimed_at = NULL
       WHERE status = 'claimed' AND claimed_at < ?`
    )
    .bind(leaseCutoff)
    .run();

  const pending = await db
    .prepare(
      `SELECT * FROM outbox WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`
    )
    .bind(limit)
    .all<OutboxRow>();

  const rows = pending.results || [];
  if (rows.length === 0) return [];

  const claimStmt = db.prepare(
    `UPDATE outbox SET status = 'claimed', claimed_at = ? WHERE id = ? AND status = 'pending'`
  );
  const claimResults = await db.batch(rows.map((r) => claimStmt.bind(now, r.id)));
  return rows.filter((_, idx) => (claimResults[idx]?.meta?.changes ?? 0) > 0);
}

export async function ackOutboxItem(db: D1Database, id: string): Promise<boolean> {
  await ensureSchema(db);
  const res = await db.prepare("DELETE FROM outbox WHERE id = ?").bind(id).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function releaseOutboxItem(db: D1Database, id: string): Promise<boolean> {
  await ensureSchema(db);
  const res = await db
    .prepare("UPDATE outbox SET status = 'pending', claimed_at = NULL WHERE id = ?")
    .bind(id)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function queueOutboxItem(
  db: D1Database,
  config: ConfigRow,
  params: { recipients: string; chatTitle?: string; body: string }
): Promise<{ ok: true; id: string; require_approval: boolean } | { ok: false; error: string }> {
  await ensureSchema(db);
  const now = Date.now();
  const oneHourAgo = now - 3_600_000;

  const sentCount = await db
    .prepare("SELECT COUNT(*) as c FROM send_log WHERE sent_at > ?")
    .bind(oneHourAgo)
    .first<{ c: number }>();
  if ((sentCount?.c ?? 0) >= config.hourly_send_cap) {
    return {
      ok: false,
      error: `Hourly outbound cap (${config.hourly_send_cap}/hr) reached. Adjust in your dashboard if needed.`,
    };
  }

  const normRecip = normalizePhone(params.recipients);
  const allowRows = (
    await db.prepare("SELECT * FROM allowlist").all<AllowlistRow>()
  ).results || [];

  const matchedAllow = allowRows.find((a) => {
    if (a.target_type === "phone") return normalizePhone(a.target_value) === normRecip;
    return (
      a.target_value.toLowerCase() === (params.chatTitle || "").toLowerCase() ||
      a.target_value.toLowerCase() === params.recipients.toLowerCase()
    );
  });

  if (config.allowlist_only && !matchedAllow) {
    return {
      ok: false,
      error: "Allowlist-only mode is enabled and this recipient/chat is not on your allowlist.",
    };
  }

  const requireApproval = matchedAllow
    ? matchedAllow.auto_send === 0
    : config.require_approval_default === 1;

  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO outbox (id, chat_title, recipients, body, require_approval, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`
      )
      .bind(id, params.chatTitle || "", params.recipients, params.body, requireApproval ? 1 : 0, now),
    db.prepare("INSERT INTO send_log (sent_at) VALUES (?)").bind(now),
    db.prepare("DELETE FROM send_log WHERE sent_at < ?").bind(now - 86_400_000),
  ]);

  return { ok: true, id, require_approval: requireApproval };
}

export function parseVcf(vcfText: string): { name: string; phone: string; normalized: string }[] {
  const contacts: { name: string; phone: string; normalized: string }[] = [];
  const cards = vcfText.split(/BEGIN:VCARD/i);
  for (const card of cards) {
    if (!/END:VCARD/i.test(card)) continue;
    const unfolded = card.replace(/\r?\n[ \t]/g, "");
    const lines = unfolded.split(/\r?\n/);
    let fn = "";
    const phones: string[] = [];
    for (const line of lines) {
      if (/^FN[;:]/i.test(line)) {
        fn = line.slice(line.indexOf(":") + 1).trim();
      } else if (/^TEL[;:]/i.test(line)) {
        const p = line.slice(line.indexOf(":") + 1).trim();
        if (p) phones.push(p);
      }
    }
    if (!fn || phones.length === 0) continue;
    for (const phone of phones) {
      const normalized = normalizePhone(phone);
      if (normalized.length >= 7) {
        contacts.push({ name: fn, phone, normalized });
      }
    }
  }
  return contacts;
}

export async function importContacts(
  db: D1Database,
  parsed: { name: string; phone: string; normalized: string }[]
): Promise<number> {
  await ensureSchema(db);
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO contacts (name, phone, normalized_phone, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(name, normalized_phone) DO UPDATE SET phone = excluded.phone, updated_at = excluded.updated_at`
  );
  // Batch in chunks of 100 for D1 limits
  let total = 0;
  for (let i = 0; i < parsed.length; i += 100) {
    const chunk = parsed.slice(i, i + 100);
    await db.batch(chunk.map((c) => stmt.bind(c.name, c.phone, c.normalized, now)));
    total += chunk.length;
  }
  return total;
}

export async function getAllPreferences(db: D1Database): Promise<Record<string, string>> {
  await ensureSchema(db);
  const rows = (
    await db.prepare("SELECT key, value FROM user_preferences").all<{ key: string; value: string }>()
  ).results || [];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function searchContactsWithPriority(
  db: D1Database,
  query: string,
  limit = 10
): Promise<ContactRow[]> {
  await ensureSchema(db);
  const q = query.trim().toLowerCase();
  const prefs = await getAllPreferences(db);
  const priorityLastNames = (prefs["family_last_names"] || prefs["name_priorities"] || "")
    .split(/[,\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const like = `%${q}%`;
  const rows = (
    await db
      .prepare(
        `SELECT * FROM contacts
         WHERE LOWER(name) LIKE ? OR normalized_phone LIKE ?
         LIMIT 50`
      )
      .bind(like, like)
      .all<ContactRow>()
  ).results || [];

  rows.sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    const aExact = an === q ? 0 : 1;
    const bExact = bn === q ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aLast = an.split(/\s+/).pop() || "";
    const bLast = bn.split(/\s+/).pop() || "";
    const aPri = priorityLastNames.indexOf(aLast);
    const bPri = priorityLastNames.indexOf(bLast);
    const aScore = aPri >= 0 ? aPri : 999;
    const bScore = bPri >= 0 ? bPri : 999;
    if (aScore !== bScore) return aScore - bScore;
    return an.localeCompare(bn);
  });

  return rows.slice(0, limit);
}

export async function listChats(db: D1Database, limit = 25): Promise<
  { chat_title: string; recipients: string; message_count: number; unread_count: number; last_sent_at: number; last_body: string }[]
> {
  await ensureSchema(db);
  const res = await db
    .prepare(
      `SELECT
         m.chat_title,
         m.recipients,
         COUNT(*) as message_count,
         SUM(m.is_unread) as unread_count,
         MAX(m.sent_at) as last_sent_at,
         (SELECT m2.body FROM messages m2 WHERE m2.chat_key = m.chat_key ORDER BY m2.sent_at DESC, m2.id DESC LIMIT 1) as last_body
       FROM messages m
       GROUP BY m.chat_key
       ORDER BY last_sent_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<{
      chat_title: string;
      recipients: string;
      message_count: number;
      unread_count: number;
      last_sent_at: number;
      last_body: string;
    }>();
  return res.results || [];
}

export async function readChatMessages(
  db: D1Database,
  chatTitleQuery: string,
  limit = MAX_MESSAGES_PER_CHAT
): Promise<MessageRow[]> {
  await ensureSchema(db);
  const cap = Math.min(Math.max(1, limit), MAX_MESSAGES_PER_CHAT);
  const q = chatTitleQuery.trim().toLowerCase();
  const exact = await db
    .prepare(
      `SELECT * FROM messages WHERE chat_key = ? ORDER BY sent_at DESC, id DESC LIMIT ?`
    )
    .bind(q, cap)
    .all<MessageRow>();
  if (exact.results && exact.results.length > 0) return exact.results.reverse();

  const fuzzy = await db
    .prepare(
      `SELECT * FROM messages WHERE chat_key LIKE ? OR recipients LIKE ? ORDER BY sent_at DESC, id DESC LIMIT ?`
    )
    .bind(`%${q}%`, `%${q}%`, cap)
    .all<MessageRow>();
  return (fuzzy.results || []).reverse();
}
