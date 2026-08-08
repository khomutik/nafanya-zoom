import { DurableObject } from "cloudflare:workers";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function normalizeMeetingId(value) {
  return String(value || "").replace(/[^0-9A-Za-z_-]/gu, "").slice(0, 128);
}

export function teamChatTestEnabled(env, meetingId) {
  if (!/^(?:1|true|yes)$/iu.test(String(env?.ZOOM_TEAM_CHAT_TEST_ENABLED || ""))) return false;
  const allowed = new Set(String(env?.ZOOM_TEAM_CHAT_TEST_MEETING_IDS || "").split(",").map(normalizeMeetingId).filter(Boolean));
  return allowed.has(normalizeMeetingId(meetingId));
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(String(value || "")), (character) => character.charCodeAt(0));
}

async function encryptionKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(secret || "")));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(token, secret) {
  if (!secret) throw new Error("team_chat_token_encryption_key_missing");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), encoder.encode(JSON.stringify(token)));
  return { version: 1, iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptToken(payload, secret) {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(payload?.iv) }, await encryptionKey(secret), base64ToBytes(payload?.ciphertext));
  return JSON.parse(decoder.decode(plaintext));
}

export class ZoomTeamChatState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
  }

  allowed(meetingId) {
    const normalized = normalizeMeetingId(meetingId);
    if (!teamChatTestEnabled(this.env, normalized)) throw new Error("team_chat_test_meeting_not_allowed");
    return normalized;
  }

  async beginOAuth({ meetingId } = {}) {
    const normalized = this.allowed(meetingId);
    const stateId = crypto.randomUUID();
    await this.ctx.storage.put(`oauth:${stateId}`, { meetingId: normalized, expiresAt: Date.now() + 10 * 60_000 });
    return { ok: true, stateId, meetingId: normalized };
  }

  async consumeOAuth({ stateId } = {}) {
    const key = `oauth:${String(stateId || "")}`;
    const pending = await this.ctx.storage.get(key);
    await this.ctx.storage.delete(key);
    if (!pending?.meetingId || pending.expiresAt < Date.now()) throw new Error("team_chat_oauth_state_invalid");
    return { ok: true, meetingId: this.allowed(pending.meetingId) };
  }

  async storeToken({ token } = {}) {
    const encrypted = await encryptToken(token, this.env.ZOOM_TEAM_CHAT_TOKEN_ENCRYPTION_KEY);
    await this.ctx.storage.put("oauth-token", encrypted);
    return { ok: true };
  }

  async getToken() {
    const encrypted = await this.ctx.storage.get("oauth-token");
    return { ok: true, token: encrypted ? await decryptToken(encrypted, this.env.ZOOM_TEAM_CHAT_TOKEN_ENCRYPTION_KEY) : null };
  }

  async tokenStatus() {
    const { token } = await this.getToken();
    return { ok: true, connected: Boolean(token?.access_token), expiresAt: Number(token?.expires_at || 0), scope: String(token?.scope || "") };
  }

  async getMessageState({ meetingId } = {}) {
    const normalized = this.allowed(meetingId);
    return { ok: true, state: await this.ctx.storage.get(`message:${normalized}`) || { meetingId: normalized, version: 0, parts: [], lastMessages: [], lastError: "" } };
  }

  async storeMessageState({ meetingId, state } = {}) {
    const normalized = this.allowed(meetingId);
    const clean = { ...state, meetingId: normalized, parts: Array.isArray(state?.parts) ? state.parts.slice(0, 50) : [], lastMessages: Array.isArray(state?.lastMessages) ? state.lastMessages.slice(0, 50) : [], updatedAt: Date.now() };
    await this.ctx.storage.put(`message:${normalized}`, clean);
    return { ok: true, state: clean };
  }
}
