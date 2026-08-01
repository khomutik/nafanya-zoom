import { createDecipheriv, createHmac, createHash, timingSafeEqual } from "node:crypto";

const ZOOM_APP_CONTEXT_TAG_BYTES = 16;
const ZOOM_APP_SESSION_VERSION = 1;
const DEFAULT_SESSION_SECONDS = 12 * 60 * 60;

function decodeBase64Url(value) {
  const normalized = String(value || "").trim().replace(/-/gu, "+").replace(/_/gu, "/");
  if (!normalized) throw new Error("zoom_app_context_missing");
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padding), "base64");
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function sessionKey(secret) {
  return createHash("sha256").update("nafanya-zoom-app-session\0", "utf8").update(String(secret || ""), "utf8").digest();
}

function signature(value, secret) {
  return createHmac("sha256", sessionKey(secret)).update(value, "utf8").digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function decryptZoomAppContext(encodedContext, clientSecret, { nowMs = Date.now(), requireMeeting = true } = {}) {
  if (!String(clientSecret || "").trim()) throw new Error("zoom_app_secret_missing");
  const packed = decodeBase64Url(encodedContext);
  let offset = 0;
  if (packed.length < 1 + 1 + 2 + 4 + ZOOM_APP_CONTEXT_TAG_BYTES) throw new Error("zoom_app_context_invalid");

  const ivLength = packed.readUInt8(offset);
  offset += 1;
  if (!ivLength || offset + ivLength > packed.length) throw new Error("zoom_app_context_invalid");
  const iv = packed.subarray(offset, offset + ivLength);
  offset += ivLength;

  if (offset + 2 > packed.length) throw new Error("zoom_app_context_invalid");
  const aadLength = packed.readUInt16LE(offset);
  offset += 2;
  if (offset + aadLength + 4 + ZOOM_APP_CONTEXT_TAG_BYTES > packed.length) throw new Error("zoom_app_context_invalid");
  const aad = packed.subarray(offset, offset + aadLength);
  offset += aadLength;

  const declaredLittleEndian = packed.readUInt32LE(offset);
  const declaredBigEndian = packed.readUInt32BE(offset);
  offset += 4;
  const actualCipherLength = packed.length - offset - ZOOM_APP_CONTEXT_TAG_BYTES;
  if (actualCipherLength < 1 || (declaredLittleEndian !== actualCipherLength && declaredBigEndian !== actualCipherLength)) {
    throw new Error("zoom_app_context_invalid");
  }
  const ciphertext = packed.subarray(offset, offset + actualCipherLength);
  const authTag = packed.subarray(offset + actualCipherLength);

  try {
    const key = createHash("sha256").update(String(clientSecret), "utf8").digest();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    if (aad.length) decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const context = JSON.parse(plaintext);
    const nowSeconds = Math.floor(nowMs / 1000);
    const expiresAt = Number(context?.exp || 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) throw new Error("zoom_app_context_expired");
    if (!/^(?:meeting|panel)$/u.test(String(context?.typ || ""))) throw new Error("zoom_app_context_wrong_surface");
    if (requireMeeting && !String(context?.mid || "").trim()) throw new Error("zoom_app_meeting_required");
    return context;
  } catch (error) {
    if (/^zoom_app_/u.test(String(error?.message || ""))) throw error;
    throw new Error("zoom_app_context_invalid");
  }
}

export function issueZoomAppSession(context, secret, { nowMs = Date.now(), maxAgeSeconds = DEFAULT_SESSION_SECONDS } = {}) {
  if (!String(secret || "").trim()) throw new Error("zoom_app_session_secret_missing");
  const nowSeconds = Math.floor(nowMs / 1000);
  const expiresAt = nowSeconds + maxAgeSeconds;
  if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds || !String(context?.mid || "").trim()) {
    throw new Error("zoom_app_context_invalid");
  }
  const payload = encodeBase64Url(JSON.stringify({
    v: ZOOM_APP_SESSION_VERSION,
    exp: expiresAt,
    mid: String(context.mid),
    typ: String(context.typ || "meeting"),
    uid: String(context.uid || "")
  }));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyZoomAppSession(value, secret, { nowMs = Date.now() } = {}) {
  try {
    const [payload, suppliedSignature, extra] = String(value || "").split(".");
    if (!payload || !suppliedSignature || extra || !safeEqual(suppliedSignature, signature(payload, secret))) return null;
    const session = JSON.parse(decodeBase64Url(payload).toString("utf8"));
    const nowSeconds = Math.floor(nowMs / 1000);
    if (session?.v !== ZOOM_APP_SESSION_VERSION || Number(session?.exp || 0) <= nowSeconds || !String(session?.mid || "").trim()) return null;
    return session;
  } catch {
    return null;
  }
}

export function buildZoomAppSessionCookie(name, value, maxAgeSeconds = DEFAULT_SESSION_SECONDS) {
  return `${name}=${value}; HttpOnly; Secure; SameSite=None; Path=/nafanya-zoom-control; Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}`;
}
