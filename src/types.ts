import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
}

export interface ConfigRow {
  id: number;
  password_hash: string;
  password_salt: string;
  session_secret: string;
  api_key_hash: string;
  api_key_prefix: string;
  mcp_bearer_hash: string | null;
  mcp_bearer_enabled: number;
  hourly_send_cap: number;
  require_approval_default: number;
  allowlist_only: number;
  created_at: number;
}

export interface ContactRow {
  id: number;
  name: string;
  phone: string;
  normalized_phone: string;
  notes: string;
  updated_at: number;
}

export interface MessageRow {
  id: number;
  chat_key: string;
  chat_title: string;
  recipients: string;
  sender: string;
  body: string;
  sent_at: number;
  sent_at_label: string;
  is_unread: number;
  message_hash: string;
  created_at: number;
}

export interface OutboxRow {
  id: string;
  chat_title: string;
  recipients: string;
  body: string;
  require_approval: number;
  status: "pending" | "claimed";
  claimed_at: number | null;
  created_at: number;
}

export interface AllowlistRow {
  id: number;
  target_type: "phone" | "chat";
  target_value: string;
  label: string;
  auto_send: number;
  created_at: number;
}

export interface OAuthUserProps {
  sub: string;
  scopes: string[];
  clientLabel?: string;
}
