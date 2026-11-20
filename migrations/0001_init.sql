-- AI Text Hub D1 Schema
-- Note: Worker also auto-bootstraps these tables on first run for true 1-click deploys.

CREATE TABLE IF NOT EXISTS config (
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
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  normalized_phone TEXT NOT NULL,
  notes TEXT DEFAULT '',
  updated_at INTEGER NOT NULL,
  UNIQUE(name, normalized_phone)
);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(normalized_phone);

CREATE TABLE IF NOT EXISTS allowlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK (target_type IN ('phone', 'chat')),
  target_value TEXT NOT NULL,
  label TEXT DEFAULT '',
  auto_send INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(target_type, target_value)
);

CREATE TABLE IF NOT EXISTS messages (
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
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_key, sent_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at DESC);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  chat_title TEXT DEFAULT '',
  recipients TEXT NOT NULL,
  body TEXT NOT NULL,
  require_approval INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed')),
  claimed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, created_at ASC);

CREATE TABLE IF NOT EXISTS send_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_send_log_time ON send_log(sent_at);

CREATE TABLE IF NOT EXISTS user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  ip TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
