const enc = new TextEncoder();

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomHex(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

export function generateApiKey(prefix = "ath"): { key: string; prefixDisplay: string } {
  const raw = randomHex(24);
  const key = `${prefix}_${raw}`;
  return { key, prefixDisplay: `${prefix}_${raw.slice(0, 6)}...${raw.slice(-4)}` };
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return toHex(digest);
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

export async function hashPassword(
  password: string,
  saltHex?: string
): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return { hash: toHex(derived), salt: toHex(salt) };
}

export async function verifyPassword(
  password: string,
  expectedHash: string,
  saltHex: string
): Promise<boolean> {
  const { hash } = await hashPassword(password, saltHex);
  return timingSafeEqualStr(hash, expectedHash);
}

export async function signToken(payload: string, secretHex: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    fromHex(secretHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${toHex(sig)}`;
}

export async function verifySignedToken(
  token: string,
  secretHex: string
): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await signToken(payload, secretHex);
  const expectedSig = expected.slice(expected.lastIndexOf(".") + 1);
  return timingSafeEqualStr(sig, expectedSig) ? payload : null;
}

export async function createSessionCookie(
  secretHex: string,
  userId = 1,
  maxAgeSec = 60 * 60 * 24 * 7
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSec;
  const signed = await signToken(`user:${userId}:${exp}`, secretHex);
  return `ath_session=${signed}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie(): string {
  return "ath_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export async function getSessionUserId(request: Request, secretHex: string): Promise<number | null> {
  const raw = getCookie(request, "ath_session");
  if (!raw) return null;
  const payload = await verifySignedToken(raw, secretHex);
  if (!payload) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.startsWith("user:")) {
    const parts = payload.split(":");
    const uid = parseInt(parts[1] || "0", 10);
    const exp = parseInt(parts[2] || "0", 10);
    if (Number.isFinite(uid) && uid > 0 && Number.isFinite(exp) && exp > nowSec) {
      return uid;
    }
    return null;
  }
  if (payload.startsWith("owner:")) {
    const exp = parseInt(payload.slice(6), 10);
    return Number.isFinite(exp) && exp > nowSec ? 1 : null;
  }
  return null;
}

export async function isSessionValid(request: Request, secretHex: string): Promise<boolean> {
  return (await getSessionUserId(request, secretHex)) !== null;
}

export async function createCsrfToken(secretHex: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  return signToken(`csrf:${ts}:${randomHex(8)}`, secretHex);
}

export async function verifyCsrfToken(token: string, secretHex: string): Promise<boolean> {
  const payload = await verifySignedToken(token, secretHex);
  if (!payload || !payload.startsWith("csrf:")) return false;
  const parts = payload.split(":");
  const ts = parseInt(parts[1] || "0", 10);
  const now = Math.floor(Date.now() / 1000);
  return Number.isFinite(ts) && now - ts >= 0 && now - ts <= 3600;
}

export function extractBearerOrApiKey(request: Request): string | null {
  const auth = request.headers.get("Authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null;
  }
  const xKey = request.headers.get("X-API-Key");
  return xKey ? xKey.trim() : null;
}
