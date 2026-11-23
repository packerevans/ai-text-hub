import { randomHex, sha256Hex } from "./crypto";
import type { AllowlistRow, ConfigRow, ContactRow, MessageRow, OutboxRow } from "./types";

const MAX_MESSAGES_PER_CHAT = 6;
const OUTBOX_LEASE_MS = 90_000;
const CONTACTS_SYNC_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
export const DAILY_FREE_AI_LIMIT = 2000;
export const AI_UNITS_PER_DRAFT = 100;

let schemaReady = false;

async function hasColumn(db: D1Database, table: string, col: string): Promise<boolean> {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return (info.results || []).some((r) => r.name === col);
}

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
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
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
    `CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key_hash)`,
    `CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      normalized_phone TEXT NOT NULL,
      notes TEXT DEFAULT '',
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, name, normalized_phone)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(user_id, name COLLATE NOCASE)`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(user_id, normalized_phone)`,
    `CREATE TABLE IF NOT EXISTS allowlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      target_type TEXT NOT NULL CHECK (target_type IN ('phone', 'chat')),
      target_value TEXT NOT NULL,
      label TEXT DEFAULT '',
      auto_send INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, target_type, target_value)
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
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
      UNIQUE(user_id, chat_key, message_hash)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(user_id, chat_key, sent_at DESC, id DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(user_id, sent_at DESC)`,
    `CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL DEFAULT 1,
      chat_title TEXT DEFAULT '',
      recipients TEXT NOT NULL,
      body TEXT NOT NULL,
      require_approval INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed')),
      claimed_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(user_id, status, created_at ASC)`,
    `CREATE TABLE IF NOT EXISTS send_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      sent_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_send_log_time ON send_log(user_id, sent_at)`,
    `CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER NOT NULL DEFAULT 1,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, key)
    )`,
    `CREATE TABLE IF NOT EXISTS auth_rate_limits (
      ip TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      window_start INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS signup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      signed_up_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS redeemed_sessions (
      session_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      redeemed_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS shortcut_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      task_type TEXT NOT NULL CHECK (task_type IN ('find_contact', 'fetch_chat', 'add_contact')),
      query TEXT NOT NULL,
      item_limit INTEGER NOT NULL DEFAULT 10,
      days_back INTEGER NOT NULL DEFAULT 30,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, task_type, query)
    )`,
    `CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      contact_name TEXT NOT NULL,
      note TEXT NOT NULL,
      due_at TEXT DEFAULT '',
      done INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
  ];
  await db.batch(stmts.map((sql) => db.prepare(sql)));

  // Migrate legacy single-user config row into users table if needed
  const userCountRow = await db.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>();
  if ((userCountRow?.c ?? 0) === 0) {
    const legacy = await db.prepare("SELECT * FROM config WHERE id = 1").first<ConfigRow>();
    if (legacy) {
      await db
        .prepare(
          `INSERT INTO users (id, username, password_hash, password_salt, session_secret, api_key_hash, api_key_prefix, mcp_bearer_hash, mcp_bearer_enabled, hourly_send_cap, require_approval_default, allowlist_only, created_at)
           VALUES (1, 'admin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          legacy.password_hash,
          legacy.password_salt,
          legacy.session_secret,
          legacy.api_key_hash,
          legacy.api_key_prefix,
          legacy.mcp_bearer_hash,
          legacy.mcp_bearer_enabled,
          legacy.hourly_send_cap,
          legacy.require_approval_default,
          legacy.allowlist_only,
          legacy.created_at
        )
        .run();
    }
  }

  // Ensure legacy tables from single-user installs get user_id column & multi-user constraints
  if (!(await hasColumn(db, "contacts", "user_id"))) {
    await db.batch([
      db.prepare(`CREATE TABLE contacts_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        normalized_phone TEXT NOT NULL,
        notes TEXT DEFAULT '',
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, name, normalized_phone)
      )`),
      db.prepare(`INSERT INTO contacts_v2 (id, user_id, name, phone, normalized_phone, notes, updated_at)
        SELECT id, 1, name, phone, normalized_phone, notes, updated_at FROM contacts`),
      db.prepare(`DROP TABLE contacts`),
      db.prepare(`ALTER TABLE contacts_v2 RENAME TO contacts`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(user_id, name COLLATE NOCASE)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(user_id, normalized_phone)`),
    ]);
  }
  if (!(await hasColumn(db, "allowlist", "user_id"))) {
    await db.batch([
      db.prepare(`CREATE TABLE allowlist_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL DEFAULT 1,
        target_type TEXT NOT NULL CHECK (target_type IN ('phone', 'chat')),
        target_value TEXT NOT NULL,
        label TEXT DEFAULT '',
        auto_send INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        UNIQUE(user_id, target_type, target_value)
      )`),
      db.prepare(`INSERT INTO allowlist_v2 (id, user_id, target_type, target_value, label, auto_send, created_at)
        SELECT id, 1, target_type, target_value, label, auto_send, created_at FROM allowlist`),
      db.prepare(`DROP TABLE allowlist`),
      db.prepare(`ALTER TABLE allowlist_v2 RENAME TO allowlist`),
    ]);
  }
  if (!(await hasColumn(db, "messages", "user_id"))) {
    await db.batch([
      db.prepare(`CREATE TABLE messages_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL DEFAULT 1,
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
        UNIQUE(user_id, chat_key, message_hash)
      )`),
      db.prepare(`INSERT INTO messages_v2 (id, user_id, chat_key, chat_title, recipients, sender, body, sent_at, sent_at_label, is_unread, message_hash, created_at)
        SELECT id, 1, chat_key, chat_title, recipients, sender, body, sent_at, sent_at_label, is_unread, message_hash, created_at FROM messages`),
      db.prepare(`DROP TABLE messages`),
      db.prepare(`ALTER TABLE messages_v2 RENAME TO messages`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(user_id, chat_key, sent_at DESC, id DESC)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(user_id, sent_at DESC)`),
    ]);
  }
  if (!(await hasColumn(db, "outbox", "user_id"))) {
    await db.prepare("ALTER TABLE outbox ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(user_id, status, created_at ASC)").run();
  }
  if (!(await hasColumn(db, "send_log", "user_id"))) {
    await db.prepare("ALTER TABLE send_log ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_send_log_time ON send_log(user_id, sent_at)").run();
  }
  if (!(await hasColumn(db, "user_preferences", "user_id"))) {
    await db.batch([
      db.prepare(`CREATE TABLE user_preferences_v2 (
        user_id INTEGER NOT NULL DEFAULT 1,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      )`),
      db.prepare(`INSERT INTO user_preferences_v2 (user_id, key, value, updated_at)
        SELECT 1, key, value, updated_at FROM user_preferences`),
      db.prepare(`DROP TABLE user_preferences`),
      db.prepare(`ALTER TABLE user_preferences_v2 RENAME TO user_preferences`),
    ]);
  }

  if (!(await hasColumn(db, "users", "auto_draft_enabled"))) {
    await db.prepare("ALTER TABLE users ADD COLUMN auto_draft_enabled INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!(await hasColumn(db, "users", "auto_draft_max_participants"))) {
    await db.prepare("ALTER TABLE users ADD COLUMN auto_draft_max_participants INTEGER NOT NULL DEFAULT 4").run();
  }
  if (!(await hasColumn(db, "users", "auto_draft_daily_used"))) {
    await db.prepare("ALTER TABLE users ADD COLUMN auto_draft_daily_used INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!(await hasColumn(db, "users", "auto_draft_day"))) {
    await db.prepare("ALTER TABLE users ADD COLUMN auto_draft_day TEXT NOT NULL DEFAULT ''").run();
  }
  if (!(await hasColumn(db, "users", "is_pro"))) {
    await db.prepare("ALTER TABLE users ADD COLUMN is_pro INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!(await hasColumn(db, "users", "pro_until"))) {
    await db.prepare("ALTER TABLE users ADD COLUMN pro_until INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!(await hasColumn(db, "users", "email"))) {
    await db.prepare("ALTER TABLE users ADD COLUMN email TEXT").run();
  }
  await db.batch([
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_reminders_user_done ON reminders(user_id, done, id DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_mcp_bearer ON users(mcp_bearer_hash)`),
  ]);

  schemaReady = true;
}

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getEffectiveDailyUsage(user: ConfigRow): number {
  const today = utcToday();
  return user.auto_draft_day === today ? user.auto_draft_daily_used || 0 : 0;
}

export function isUserProActive(user: ConfigRow): boolean {
  return user.is_pro === 1 && (!user.pro_until || user.pro_until > Date.now());
}

export function isHostedInstance(originOrHost: string): boolean {
  const lower = originOrHost.toLowerCase();
  return lower.includes("ai-text-hub.textforme.workers.dev") || lower.includes("ai-text-hub.elevatedcleaning.workers.dev");
}

export async function recordAutoDraftUsage(db: D1Database, userId: number, units: number): Promise<void> {
  await ensureSchema(db);
  const today = utcToday();
  await db
    .prepare(
      `UPDATE users
       SET auto_draft_daily_used = CASE WHEN auto_draft_day = ? THEN auto_draft_daily_used + ? ELSE ? END,
           auto_draft_day = ?
       WHERE id = ?`
    )
    .bind(today, units, units, today, userId)
    .run();
}

export async function getAppSessionSecret(db: D1Database): Promise<string> {
  await ensureSchema(db);
  const existing = await db
    .prepare("SELECT value FROM app_meta WHERE key = 'app_session_secret'")
    .first<{ value: string }>();
  if (existing?.value) return existing.value;
  const firstUser = await db.prepare("SELECT session_secret FROM users ORDER BY id ASC LIMIT 1").first<{ session_secret: string }>();
  const secret = firstUser?.session_secret || randomHex(32);
  await db
    .prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('app_session_secret', ?)")
    .bind(secret)
    .run();
  const row = await db.prepare("SELECT value FROM app_meta WHERE key = 'app_session_secret'").first<{ value: string }>();
  return row?.value || secret;
}

export async function getUserCount(db: D1Database): Promise<number> {
  await ensureSchema(db);
  const row = await db.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>();
  return row?.c ?? 0;
}

export async function getConfig(db: D1Database, userId = 1): Promise<ConfigRow | null> {
  await ensureSchema(db);
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<ConfigRow>();
}

export async function getUserByUsername(db: D1Database, usernameOrEmail: string): Promise<ConfigRow | null> {
  await ensureSchema(db);
  const v = usernameOrEmail.trim();
  return db
    .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE")
    .bind(v, v)
    .first<ConfigRow>();
}

export async function recordSignupLog(
  db: D1Database,
  userId: number,
  email: string,
  signedUpAt = Date.now()
): Promise<void> {
  await ensureSchema(db);
  await db
    .prepare("INSERT INTO signup_logs (user_id, email, signed_up_at) VALUES (?, ?, ?)")
    .bind(userId, email.trim().toLowerCase(), signedUpAt)
    .run();
}

export async function listSignupLogs(
  db: D1Database,
  limit = 1000
): Promise<{ id: number; user_id: number; email: string; signed_up_at: number }[]> {
  await ensureSchema(db);
  const res = await db
    .prepare("SELECT id, user_id, email, signed_up_at FROM signup_logs ORDER BY id DESC LIMIT ?")
    .bind(Math.max(1, Math.min(5000, limit)))
    .all<{ id: number; user_id: number; email: string; signed_up_at: number }>();
  return res.results || [];
}

export async function claimStripeSessionOnce(
  db: D1Database,
  sessionId: string,
  userId: number
): Promise<boolean> {
  await ensureSchema(db);
  const res = await db
    .prepare("INSERT OR IGNORE INTO redeemed_sessions (session_id, user_id, redeemed_at) VALUES (?, ?, ?)")
    .bind(sessionId, userId, Date.now())
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function getUserByApiKeyHash(db: D1Database, apiKeyHash: string): Promise<ConfigRow | null> {
  await ensureSchema(db);
  return db.prepare("SELECT * FROM users WHERE api_key_hash = ?").bind(apiKeyHash).first<ConfigRow>();
}

export async function getUserByMcpBearerHash(db: D1Database, bearerHash: string): Promise<ConfigRow | null> {
  await ensureSchema(db);
  return db
    .prepare("SELECT * FROM users WHERE mcp_bearer_enabled = 1 AND mcp_bearer_hash = ?")
    .bind(bearerHash)
    .first<ConfigRow>();
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
  // Group chats from iOS Shortcuts can arrive comma-, plus-, semicolon-, newline-, or &-separated
  const phoneMatches = raw.match(/\+?\d[\d\s()-]{6,}\d/g) || [];
  if (raw.includes(" + ") || /[,;\n\r]/.test(raw) || /\s+&\s+/.test(raw)) {
    const parts = raw
      .split(/\s+\+\s+|[,;\n\r]+|\s+&\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    return Math.max(parts.length, phoneMatches.length);
  }
  return phoneMatches.length > 0 ? phoneMatches.length : 1;
}

export async function resolveFriendlyChatTitle(
  db: D1Database,
  chatTitle: string,
  recipients: string,
  userId = 1
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
        .prepare("SELECT name FROM contacts WHERE user_id = ? AND normalized_phone = ? LIMIT 1")
        .bind(userId, norm)
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
  items: IncomingMessageInput[],
  userId = 1
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
    const chatTitle = await resolveFriendlyChatTitle(db, rawChatTitle, recipients, userId);
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
      (user_id, chat_key, chat_title, recipients, sender, body, sent_at, sent_at_label, is_unread, message_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const results = await db.batch(
    validItems.map((m) =>
      insertStmt.bind(
        userId,
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
       WHERE user_id = ? AND chat_key = ?
         AND id NOT IN (
           SELECT id FROM messages
           WHERE user_id = ? AND chat_key = ?
           ORDER BY sent_at DESC, id DESC
           LIMIT ?
         )`
    );
    await db.batch(
      Array.from(affectedChats).map((ck) => pruneStmt.bind(userId, ck, userId, ck, MAX_MESSAGES_PER_CHAT))
    );
  }

  return { stored, duplicates, filtered_otp: filteredOtp };
}

export async function claimPendingOutbox(db: D1Database, limit = 10, userId = 1): Promise<OutboxRow[]> {
  await ensureSchema(db);
  const now = Date.now();
  const leaseCutoff = now - OUTBOX_LEASE_MS;

  // Release any expired leases first
  await db
    .prepare(
      `UPDATE outbox SET status = 'pending', claimed_at = NULL
       WHERE user_id = ? AND status = 'claimed' AND claimed_at < ?`
    )
    .bind(userId, leaseCutoff)
    .run();

  const pending = await db
    .prepare(
      `SELECT * FROM outbox WHERE user_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT ?`
    )
    .bind(userId, limit)
    .all<OutboxRow>();

  const rows = pending.results || [];
  if (rows.length === 0) return [];

  const claimStmt = db.prepare(
    `UPDATE outbox SET status = 'claimed', claimed_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'`
  );
  const claimResults = await db.batch(rows.map((r) => claimStmt.bind(now, r.id, userId)));
  return rows.filter((_, idx) => (claimResults[idx]?.meta?.changes ?? 0) > 0);
}

export async function ackOutboxItem(db: D1Database, id: string, userId = 1): Promise<boolean> {
  await ensureSchema(db);
  const res = await db.prepare("DELETE FROM outbox WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function releaseOutboxItem(db: D1Database, id: string, userId = 1): Promise<boolean> {
  await ensureSchema(db);
  const res = await db
    .prepare("UPDATE outbox SET status = 'pending', claimed_at = NULL WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function queueOutboxItem(
  db: D1Database,
  config: ConfigRow,
  params: { recipients: string; chatTitle?: string; body: string }
): Promise<{ ok: true; id: string; require_approval: boolean } | { ok: false; error: string }> {
  await ensureSchema(db);
  if (countChatParticipants(params.recipients) > 4 || countChatParticipants(params.chatTitle || "") > 4) {
    return {
      ok: false,
      error: "Group chats with more than 4 people are blocked.",
    };
  }
  const now = Date.now();
  const oneHourAgo = now - 3_600_000;

  const sentCount = await db
    .prepare("SELECT COUNT(*) as c FROM send_log WHERE user_id = ? AND sent_at > ?")
    .bind(config.id, oneHourAgo)
    .first<{ c: number }>();
  if ((sentCount?.c ?? 0) >= config.hourly_send_cap) {
    return {
      ok: false,
      error: `Hourly outbound cap (${config.hourly_send_cap}/hr) reached. Adjust in your dashboard if needed.`,
    };
  }

  const rawParts = params.recipients
    .split(/\s+\+\s+|[,;\n\r]+|\s+&\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const resolvedParts: string[] = [];
  for (const part of rawParts) {
    const d = normalizePhone(part);
    if (d.length >= 7) {
      resolvedParts.push(d.length === 10 ? `+1${d}` : part.startsWith("+") ? part : `+${d}`);
    } else {
      const contactMatch = (await searchContactsWithPriority(db, part, 1, config.id))[0];
      if (contactMatch?.phone) {
        const md = normalizePhone(contactMatch.phone);
        resolvedParts.push(md.length === 10 ? `+1${md}` : contactMatch.phone);
      } else {
        resolvedParts.push(part);
      }
    }
  }
  const resolvedRecipients = resolvedParts.join(",");
  const normRecip = normalizePhone(resolvedRecipients);
  const allowRows = (
    await db.prepare("SELECT * FROM allowlist WHERE user_id = ?").bind(config.id).all<AllowlistRow>()
  ).results || [];

  const matchedAllow = allowRows.find((a) => {
    if (a.target_type === "phone") return normalizePhone(a.target_value) === normRecip;
    return (
      a.target_value.toLowerCase() === (params.chatTitle || "").toLowerCase() ||
      a.target_value.toLowerCase() === resolvedRecipients.toLowerCase()
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
        `INSERT INTO outbox (id, user_id, chat_title, recipients, body, require_approval, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .bind(id, config.id, params.chatTitle || "", resolvedRecipients, params.body, requireApproval ? 1 : 0, now),
    db.prepare("INSERT INTO send_log (user_id, sent_at) VALUES (?, ?)").bind(config.id, now),
    db.prepare("DELETE FROM send_log WHERE user_id = ? AND sent_at < ?").bind(config.id, now - 86_400_000),
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

export async function findUnknownMessageNumbers(
  db: D1Database,
  items: IncomingMessageInput[],
  userId = 1
): Promise<string[]> {
  await ensureSchema(db);
  const candidates = new Set<string>();
  for (const item of items) {
    const rawFields = [item.sender || "", item.recipients || "", item.chat_title || ""];
    for (const field of rawFields) {
      const parts = field.split(/\s+\+\s+|[,;\n\r]+|\s+&\s+/);
      for (const p of parts) {
        const norm = normalizePhone(p);
        if (norm.length >= 7 && norm.length <= 15) {
          candidates.add(norm);
        }
      }
    }
  }
  const all = Array.from(candidates).slice(0, 30);
  if (all.length === 0) return [];
  const placeholders = all.map(() => "?").join(",");
  const res = await db
    .prepare(`SELECT normalized_phone FROM contacts WHERE user_id = ? AND normalized_phone IN (${placeholders})`)
    .bind(userId, ...all)
    .all<{ normalized_phone: string }>();
  const known = new Set((res.results || []).map((r) => r.normalized_phone));
  const suffixes = new Set<string>();
  for (const num of all) {
    if (!known.has(num)) {
      suffixes.add(num.slice(-4));
    }
  }
  return Array.from(suffixes).slice(0, 10);
}

export async function importContacts(
  db: D1Database,
  parsed: { name: string; phone: string; normalized: string }[],
  userId = 1
): Promise<number> {
  await ensureSchema(db);
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO contacts (user_id, name, phone, normalized_phone, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, name, normalized_phone) DO UPDATE SET phone = excluded.phone, updated_at = excluded.updated_at`
  );
  // Batch in chunks of 100 for D1 limits
  let total = 0;
  for (let i = 0; i < parsed.length; i += 100) {
    const chunk = parsed.slice(i, i + 100);
    await db.batch(chunk.map((c) => stmt.bind(userId, c.name, c.phone, c.normalized, now)));
    total += chunk.length;
  }
  return total;
}

export async function getAllPreferences(db: D1Database, userId = 1): Promise<Record<string, string>> {
  await ensureSchema(db);
  const rows = (
    await db.prepare("SELECT key, value FROM user_preferences WHERE user_id = ?").bind(userId).all<{ key: string; value: string }>()
  ).results || [];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function isContactsSyncNeeded(db: D1Database, userId = 1): Promise<boolean> {
  await ensureSchema(db);
  const countRow = await db
    .prepare("SELECT COUNT(*) as c FROM contacts WHERE user_id = ?")
    .bind(userId)
    .first<{ c: number }>();
  if ((countRow?.c ?? 0) === 0) return true;

  const prefs = await getAllPreferences(db, userId);
  const lastSync = parseInt(prefs["last_contacts_sync_at"] || "0", 10) || 0;
  const requestedAt = parseInt(prefs["contacts_sync_requested_at"] || "0", 10) || 0;
  if (requestedAt > lastSync) return true;
  if (Date.now() - lastSync > CONTACTS_SYNC_INTERVAL_MS) return true;
  return false;
}

export async function markContactsSynced(db: D1Database, userId = 1): Promise<void> {
  await ensureSchema(db);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO user_preferences (user_id, key, value, updated_at)
         VALUES (?, 'last_contacts_sync_at', ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .bind(userId, String(now), now),
    db
      .prepare(
        `INSERT INTO user_preferences (user_id, key, value, updated_at)
         VALUES (?, 'contacts_sync_requested_at', '0', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = '0', updated_at = excluded.updated_at`
      )
      .bind(userId, now),
  ]);
}

export async function requestContactsSync(db: D1Database, userId = 1): Promise<void> {
  await ensureSchema(db);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO user_preferences (user_id, key, value, updated_at)
       VALUES (?, 'contacts_sync_requested_at', ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(userId, String(now), now)
    .run();
}

export async function searchContactsWithPriority(
  db: D1Database,
  query: string,
  limit = 10,
  userId = 1
): Promise<ContactRow[]> {
  await ensureSchema(db);
  const q = query.trim().toLowerCase();
  const prefs = await getAllPreferences(db, userId);
  const priorityLastNames = (prefs["family_last_names"] || prefs["name_priorities"] || "")
    .split(/[,\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const like = `%${q}%`;
  const rows = (
    await db
      .prepare(
        `SELECT * FROM contacts
         WHERE user_id = ? AND (LOWER(name) LIKE ? OR normalized_phone LIKE ?)
         LIMIT 50`
      )
      .bind(userId, like, like)
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

export async function listChats(db: D1Database, limit = 25, userId = 1): Promise<
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
         (SELECT m2.body FROM messages m2 WHERE m2.user_id = m.user_id AND m2.chat_key = m.chat_key ORDER BY m2.sent_at DESC, m2.id DESC LIMIT 1) as last_body
       FROM messages m
       WHERE m.user_id = ?
       GROUP BY m.chat_key
       ORDER BY last_sent_at DESC
       LIMIT ?`
    )
    .bind(userId, limit)
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
  limit = MAX_MESSAGES_PER_CHAT,
  userId = 1
): Promise<MessageRow[]> {
  await ensureSchema(db);
  const cap = Math.min(Math.max(1, limit), MAX_MESSAGES_PER_CHAT);
  const q = chatTitleQuery.trim().toLowerCase();
  const exact = await db
    .prepare(
      `SELECT * FROM messages WHERE user_id = ? AND chat_key = ? ORDER BY sent_at DESC, id DESC LIMIT ?`
    )
    .bind(userId, q, cap)
    .all<MessageRow>();
  if (exact.results && exact.results.length > 0) return exact.results.reverse();

  const fuzzy = await db
    .prepare(
      `SELECT * FROM messages WHERE user_id = ? AND (chat_key LIKE ? OR recipients LIKE ?) ORDER BY sent_at DESC, id DESC LIMIT ?`
    )
    .bind(userId, `%${q}%`, `%${q}%`, cap)
    .all<MessageRow>();
  return (fuzzy.results || []).reverse();
}

export async function queueShortcutTask(
  db: D1Database,
  userId: number,
  taskType: "find_contact" | "fetch_chat" | "add_contact",
  query: string,
  itemLimit = 10,
  daysBack = 30
): Promise<void> {
  await ensureSchema(db);
  const q = query.trim();
  if (!q) return;
  const lim = Math.min(25, Math.max(1, itemLimit));
  const days = Math.min(90, Math.max(1, daysBack));
  await db
    .prepare(
      `INSERT INTO shortcut_tasks (user_id, task_type, query, item_limit, days_back, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, task_type, query) DO UPDATE SET item_limit = excluded.item_limit, days_back = excluded.days_back, created_at = excluded.created_at`
    )
    .bind(userId, taskType, q, lim, days, Date.now())
    .run();
}

export async function claimShortcutManifest(
  db: D1Database,
  userId = 1
): Promise<{
  find_contacts: { query: string; limit: number }[];
  fetch_chats: { query: string; limit: number; days: number }[];
  add_contacts: { name: string; phone: string }[];
}> {
  await ensureSchema(db);
  const res = await db
    .prepare(
      "SELECT id, task_type, query, item_limit, days_back FROM shortcut_tasks WHERE user_id = ? ORDER BY created_at ASC LIMIT 13"
    )
    .bind(userId)
    .all<{ id: number; task_type: string; query: string; item_limit: number; days_back: number }>();
  const rows = res.results || [];
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    await db
      .prepare(`DELETE FROM shortcut_tasks WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
      .bind(userId, ...ids)
      .run();
  }
  const find_contacts: { query: string; limit: number }[] = [];
  const fetch_chats: { query: string; limit: number; days: number }[] = [];
  const add_contacts: { name: string; phone: string }[] = [];
  for (const r of rows) {
    if (r.task_type === "find_contact" && find_contacts.length < 5) {
      find_contacts.push({ query: r.query, limit: Math.min(10, Math.max(1, r.item_limit)) });
    } else if (r.task_type === "fetch_chat" && fetch_chats.length < 3) {
      fetch_chats.push({
        query: r.query,
        limit: Math.min(25, Math.max(1, r.item_limit)),
        days: Math.min(90, Math.max(1, r.days_back)),
      });
    } else if (r.task_type === "add_contact" && add_contacts.length < 5) {
      try {
        const parsed = JSON.parse(r.query) as { name?: string; phone?: string };
        if (parsed.name && parsed.phone) add_contacts.push({ name: parsed.name, phone: parsed.phone });
      } catch {}
    }
  }
  return { find_contacts, fetch_chats, add_contacts };
}

export async function createReminder(
  db: D1Database,
  userId: number,
  contactName: string,
  note: string,
  dueAt = ""
): Promise<number> {
  await ensureSchema(db);
  const res = await db
    .prepare("INSERT INTO reminders (user_id, contact_name, note, due_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, contactName.trim(), note.trim(), dueAt.trim(), Date.now())
    .run();
  return Number(res.meta?.last_row_id || 0);
}

export async function listReminders(
  db: D1Database,
  userId: number,
  includeDone = false
): Promise<{ id: number; contact_name: string; note: string; due_at: string; done: number }[]> {
  await ensureSchema(db);
  const sql = includeDone
    ? "SELECT id, contact_name, note, due_at, done FROM reminders WHERE user_id = ? ORDER BY done ASC, id DESC LIMIT 30"
    : "SELECT id, contact_name, note, due_at, done FROM reminders WHERE user_id = ? AND done = 0 ORDER BY id DESC LIMIT 30";
  const res = await db.prepare(sql).bind(userId).all<{ id: number; contact_name: string; note: string; due_at: string; done: number }>();
  return res.results || [];
}

export async function completeReminder(db: D1Database, userId: number, id: number): Promise<boolean> {
  await ensureSchema(db);
  const res = await db.prepare("UPDATE reminders SET done = 1 WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return (res.meta?.changes ?? 0) > 0;
}
