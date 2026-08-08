import { GROUP_CONFIG, getMeetingButton } from "./group-config.mjs";
import { ZoomMeetingState } from "./meeting-state.mjs";
import { ZoomSharedTimerState } from "./timer-state.mjs";
import { ZoomTeamChatState, normalizeMeetingId, teamChatTestEnabled } from "./team-chat-state.mjs";
import { buildPanelHtml } from "./panel.mjs";
import { splitZoomMessages } from "./meeting-board.mjs";
import {
  ZOOM_LIBRARY_COLLECTIONS,
  ZOOM_LIBRARY_IMPORT_MAX_BYTES,
  buildLibraryZoomMessages,
  getLibraryEntry,
  getLibraryStatus,
  mergeLibraryCollections,
  readZoomLibrary,
  saveZoomLibrary,
  validateLibraryImport
} from "./library.mjs";

export { ZoomMeetingState, ZoomSharedTimerState, ZoomTeamChatState };

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; base-uri 'none'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff"
    }
  });
}

async function secureEqual(actual, expected) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(actual || ""))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(expected || "")))
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0 && Boolean(String(expected || ""));
}

function panelToken(request) {
  return request.headers.get("x-nafanya-zoom-panel-token") || "";
}

async function panelAuthorized(request, env) {
  return secureEqual(panelToken(request), env.ZOOM_PANEL_TOKEN);
}

async function senderAuthorized(request, env) {
  return secureEqual(request.headers.get("x-nafanya-zoom-secret"), env.ZOOM_ONLY_SECRET);
}

function instanceName(env) {
  return String(env.APP_INSTANCE_ID || "default").trim().slice(0, 128) || "default";
}

function requestMeetingId(request) {
  return normalizeMeetingId(request.headers.get("x-nafanya-zoom-meeting-id"));
}

function meetingState(env, meetingId = "") {
  const base = instanceName(env);
  const name = teamChatTestEnabled(env, meetingId) ? `${base}:team-chat-test:${meetingId}` : base;
  return env.ZOOM_MEETING_STATE.getByName(name);
}

function timerState(env) {
  return env.ZOOM_SHARED_TIMER_STATE.getByName(instanceName(env));
}

function teamChatState(env) {
  return env.ZOOM_TEAM_CHAT_STATE.getByName(instanceName(env));
}

function zonedParts(timeZone, date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function sessionDate() {
  const parts = zonedParts(GROUP_CONFIG.timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateKey() {
  const parts = zonedParts(GROUP_CONFIG.timeZone);
  return `${parts.day}.${parts.month}`;
}

async function readJsonLimited(request, limit) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > limit) throw Object.assign(new Error("payload_too_large"), { status: 413 });
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw Object.assign(new Error("payload_too_large"), { status: 413 });
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(buffer) || "{}");
}

async function enqueueGenerated(env, { key, label, messages }) {
  const stub = meetingState(env);
  const marker = await stub.getOutboxMarker();
  await stub.enqueueMessages(messages);
  await stub.recordPanelAction({ key, label, ok: true });
  const outbox = await stub.pullMessages({ minId: marker.nextId, limit: 50 });
  return { ok: true, key, message: `${label}: \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u043e \u0432 Zoom`, queued: outbox.messages || [] };
}

async function libraryEntryAction(env, collectionId, rawKey) {
  const definition = ZOOM_LIBRARY_COLLECTIONS[collectionId];
  const number = Number(rawKey);
  if (!definition || definition.kind !== "numbered") throw new Error("\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043a\u043d\u0438\u0433\u0430.");
  if (!Number.isInteger(number) || number < 1 || number > 9999) throw new Error("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0446\u0435\u043b\u044b\u0439 \u043d\u043e\u043c\u0435\u0440.");
  const library = await readZoomLibrary(env);
  const entry = getLibraryEntry(library, collectionId, number);
  if (!entry) throw new Error(`${definition.label}: \u043e\u0442\u0440\u044b\u0432\u043e\u043a \u2116${number} \u043d\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d.`);
  return enqueueGenerated(env, { key: `${collectionId}:${number}`, label: `${definition.label}, \u2116${number}`, messages: buildLibraryZoomMessages(collectionId, number, entry.text) });
}

async function dailyReflectionAction(env) {
  const key = dateKey();
  const library = await readZoomLibrary(env);
  const entry = getLibraryEntry(library, "daily_reflections", key);
  if (!entry) throw new Error(`\u0415\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u044f \u043d\u0430 ${key} \u043d\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d\u044b.`);
  return enqueueGenerated(env, { key: `daily_reflections:${key}`, label: `\u0415\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u044f, ${key}`, messages: buildLibraryZoomMessages("daily_reflections", key, entry.text) });
}

const BOARD_ACTIONS = Object.freeze({
  meeting_board_publish: "publish",
  meeting_board_add_entry: "add_entry",
  meeting_board_add_topic: "add_topic",
  meeting_board_mark_spoken: "mark_spoken",
  meeting_board_restore_waiting: "restore_waiting",
  meeting_board_defer_entry: "defer_entry",
  meeting_board_remove_entry: "remove_entry",
  meeting_board_remove_topic: "remove_topic",
  meeting_board_clear_all: "clear_all",
  meeting_board_clear_current: "clear_current"
});

const SPEAKER_ACTIONS = Object.freeze({
  speaker_questions_publish: "publish",
  speaker_questions_add: "add",
  speaker_questions_remove: "remove",
  speaker_questions_clear: "clear"
});

async function teamChatToken(env) {
  let { token } = await teamChatState(env).getToken();
  if (!token?.access_token) throw new Error("team_chat_oauth_required");
  if (Number(token.expires_at || 0) > Date.now() + 60_000) return token;
  const clientId = String(env.ZOOM_TEAM_CHAT_CLIENT_ID || "").trim();
  const clientSecret = String(env.ZOOM_TEAM_CHAT_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret || !token.refresh_token) throw new Error("team_chat_oauth_refresh_unavailable");
  const response = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refresh_token })
  });
  const refreshed = await response.json().catch(() => ({}));
  if (!response.ok || !refreshed.access_token) throw new Error("team_chat_oauth_refresh_failed");
  token = { ...refreshed, refresh_token: refreshed.refresh_token || token.refresh_token, expires_at: Date.now() + Math.max(60, Number(refreshed.expires_in) || 3600) * 1000 };
  await teamChatState(env).storeToken({ token });
  return token;
}

async function teamChatApi(method, path, token, body) {
  const response = await fetch(`https://api.zoom.us/v2${path}`, {
    method,
    headers: { authorization: `Bearer ${token.access_token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new Error(`team_chat_api_${response.status}`);
  return response.status === 204 ? null : response.json().catch(() => null);
}

async function reconcileTeamChat(env, meetingId, messages, version) {
  const durable = teamChatState(env);
  const { state: current } = await durable.getMessageState({ meetingId });
  if (!current.parts?.length) return { ok: true, status: "sdk_required", messages, version };
  try {
    const token = await teamChatToken(env);
    const parts = [];
    const shared = Math.min(current.parts.length, messages.length);
    for (let index = 0; index < shared; index += 1) {
      const part = current.parts[index];
      await teamChatApi("PUT", `/chat/users/me/messages/${encodeURIComponent(part.messageId)}`, token, { message: messages[index], to_channel: part.channelId });
      parts.push(part);
    }
    const channelId = String(current.parts[0]?.channelId || "");
    for (let index = shared; index < messages.length; index += 1) {
      const created = await teamChatApi("POST", "/chat/users/me/messages", token, { message: messages[index], to_channel: channelId });
      const messageId = String(created?.id || created?.message_id || "");
      if (!messageId) throw new Error("team_chat_api_missing_message_id");
      parts.push({ channelId, messageId, authorId: "me" });
    }
    for (let index = messages.length; index < current.parts.length; index += 1) {
      const part = current.parts[index];
      await teamChatApi("DELETE", `/chat/users/me/messages/${encodeURIComponent(part.messageId)}?to_channel=${encodeURIComponent(part.channelId)}`, token);
    }
    const stored = await durable.storeMessageState({ meetingId, state: { version, parts, lastMessages: messages, lastError: "" } });
    return { ok: true, status: "updated", state: stored.state };
  } catch (error) {
    await durable.storeMessageState({ meetingId, state: { ...current, version, lastMessages: messages, lastError: String(error?.message || error).slice(0, 300) } }).catch(() => null);
    return { ok: false, status: "api_error", error: String(error?.message || error).slice(0, 300) };
  }
}

async function handleAppAction(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!(await panelAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    const payload = await readJsonLimited(request, 64 * 1024);
    const meetingId = requestMeetingId(request);
    const teamChatTest = teamChatTestEnabled(env, meetingId);
    const stub = meetingState(env, meetingId);
    if (BOARD_ACTIONS[payload.action]) {
      const result = await stub.meetingBoardAction({ ...payload, boardAction: BOARD_ACTIONS[payload.action], sessionDate: sessionDate(), deliveryMode: teamChatTest ? "team_chat_test" : "outbox" });
      const teamChat = teamChatTest && !result.duplicate ? await reconcileTeamChat(env, meetingId, result.deliveryMessages || result.state?.lastMessages || [], result.state?.version || 0) : null;
      return json({ ...result, teamChat, message: result.duplicate ? "\u041d\u0430\u0436\u0430\u0442\u0438\u0435 \u0443\u0436\u0435 \u0443\u0447\u0442\u0435\u043d\u043e." : teamChat?.ok === false ? "\u041e\u0447\u0435\u0440\u0435\u0434\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0430, \u043d\u043e Team Chat \u043d\u0435 \u043e\u0431\u043d\u043e\u0432\u0438\u043b\u0441\u044f." : "\u0410\u043a\u0442\u0443\u0430\u043b\u044c\u043d\u043e\u0435 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u0432 Zoom." });
    }
    if (SPEAKER_ACTIONS[payload.action]) {
      const result = await stub.speakerQuestionsAction({ ...payload, speakerAction: SPEAKER_ACTIONS[payload.action], sessionDate: sessionDate() });
      return json({ ...result, message: result.duplicate ? "\u041d\u0430\u0436\u0430\u0442\u0438\u0435 \u0443\u0436\u0435 \u0443\u0447\u0442\u0435\u043d\u043e." : "\u0412\u043e\u043f\u0440\u043e\u0441\u044b \u0441\u043f\u0438\u043a\u0435\u0440\u0443 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u044b \u0432 Zoom." });
    }
    if (payload.action === "zoom_timer_action") return json(await timerState(env).timerAction({ ...payload, timerAction: String(payload.timerAction || "sync") }));
    if (payload.action === "test_message") return json(await enqueueGenerated(env, { key: "test_message", label: "\u0422\u0435\u0441\u0442", messages: [GROUP_CONFIG.testMessage] }));
    if (payload.action === "book_excerpt") return json(await libraryEntryAction(env, String(payload.collectionId || ""), payload.number));
    if (payload.action === "daily_reflection") return json(await dailyReflectionAction(env));
    if (payload.action === "game_question") return json(await libraryEntryAction(env, "game_questions", payload.number));
    if (payload.type === "message" || payload.key) {
      const action = getMeetingButton(String(payload.key || ""));
      if (!action?.messages.length) throw new Error("\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043a\u043d\u043e\u043f\u043a\u0430.");
      return json(await enqueueGenerated(env, { key: action.key, label: action.label, messages: action.messages.flatMap((message) => splitZoomMessages(message)) }));
    }
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error).slice(0, 300) }, Number(error?.status) || 400);
  }
}

async function handleTeamChat(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/zoom-only/team-chat/oauth/callback") {
    try {
      const code = String(url.searchParams.get("code") || "");
      const stateId = String(url.searchParams.get("state") || "");
      if (!code || !stateId) throw new Error("team_chat_oauth_callback_invalid");
      const { meetingId } = await teamChatState(env).consumeOAuth({ stateId });
      const clientId = String(env.ZOOM_TEAM_CHAT_CLIENT_ID || "");
      const clientSecret = String(env.ZOOM_TEAM_CHAT_CLIENT_SECRET || "");
      const redirectUri = String(env.ZOOM_TEAM_CHAT_REDIRECT_URI || `${url.origin}/zoom-only/team-chat/oauth/callback`);
      const response = await fetch("https://zoom.us/oauth/token", {
        method: "POST",
        headers: { authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri })
      });
      const received = await response.json().catch(() => ({}));
      if (!response.ok || !received.access_token || !received.refresh_token) throw new Error("team_chat_oauth_exchange_failed");
      await teamChatState(env).storeToken({ token: { ...received, expires_at: Date.now() + Math.max(60, Number(received.expires_in) || 3600) * 1000 } });
      return html(`<!doctype html><meta charset="utf-8"><p>Team Chat OAuth connected for test meeting ${meetingId}. You can close this window.</p>`);
    } catch (error) {
      return html(`<!doctype html><meta charset="utf-8"><p>OAuth error: ${String(error?.message || error)}</p>`, 400);
    }
  }
  if (!(await panelAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
  const meetingId = requestMeetingId(request);
  if (!teamChatTestEnabled(env, meetingId)) return json({ ok: false, error: "team_chat_test_meeting_not_allowed" }, 403);
  if (request.method === "GET" && url.pathname === "/zoom-only/team-chat/status") {
    const [oauth, message] = await Promise.all([teamChatState(env).tokenStatus(), teamChatState(env).getMessageState({ meetingId })]);
    return json({ ok: true, meetingId, oauth, messageState: message.state });
  }
  if (request.method === "POST" && url.pathname === "/zoom-only/team-chat/oauth/start") {
    const redirectUri = String(env.ZOOM_TEAM_CHAT_REDIRECT_URI || `${url.origin}/zoom-only/team-chat/oauth/callback`);
    const started = await teamChatState(env).beginOAuth({ meetingId });
    const authorize = new URL("https://zoom.us/oauth/authorize");
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", String(env.ZOOM_TEAM_CHAT_CLIENT_ID || ""));
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("state", started.stateId);
    return json({ ok: true, meetingId, authorizeUrl: authorize.toString() });
  }
  if (request.method === "POST" && url.pathname === "/zoom-only/team-chat/sdk-message") {
    const payload = await readJsonLimited(request, 64 * 1024);
    const board = (await meetingState(env, meetingId).status()).meetingBoard;
    const version = Math.max(0, Math.floor(Number(payload.version) || 0));
    const messages = (Array.isArray(payload.messages) ? payload.messages : []).map(String).filter(Boolean);
    const parts = (Array.isArray(payload.parts) ? payload.parts : []).map((item) => ({ channelId: String(item?.channelId || ""), messageId: String(item?.messageId || ""), authorId: String(item?.authorId || "") })).filter((item) => item.channelId && item.messageId);
    if (version !== Number(board?.version || 0) || !messages.length || messages.length !== parts.length) return json({ ok: false, error: "team_chat_sdk_receipt_stale_or_incomplete" }, 409);
    if (messages.some((message) => Array.from(message).length > 950)) return json({ ok: false, error: "team_chat_message_too_long" }, 400);
    return json(await teamChatState(env).storeMessageState({ meetingId, state: { version, parts, lastMessages: messages, lastError: "" } }));
  }
  return json({ ok: false, error: "method_not_allowed" }, 405);
}

async function handleLibrary(request, env) {
  if (!(await panelAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
  if (request.method === "GET") {
    try {
      return json({ ok: true, ...getLibraryStatus(await readZoomLibrary(env)) });
    } catch (error) {
      return json({ ok: false, error: String(error?.message || error).slice(0, 300) }, 500);
    }
  }
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const payload = await readJsonLimited(request, ZOOM_LIBRARY_IMPORT_MAX_BYTES);
    const validation = validateLibraryImport(payload);
    if (!validation.ok) return json({ ok: false, error: "\u0411\u0430\u0437\u0430 \u043d\u0435 \u043e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u043d\u0430.", errors: validation.errors, warnings: validation.warnings, preview: validation.preview }, 400);
    const current = await readZoomLibrary(env).catch(() => null);
    const next = mergeLibraryCollections(current, validation.collections);
    if (new URL(request.url).searchParams.get("dryRun") === "1") return json({ ok: true, validated: true, warnings: validation.warnings, preview: validation.preview, ...getLibraryStatus(next) });
    await saveZoomLibrary(env, next);
    return json({ ok: true, message: "\u041a\u043d\u0438\u0436\u043d\u0430\u044f \u0431\u0430\u0437\u0430 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0430.", warnings: validation.warnings, preview: validation.preview, ...getLibraryStatus(next) });
  } catch (error) {
    const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
    return json({ ok: false, error: error.message === "payload_too_large" ? "\u041a\u043d\u0438\u0436\u043d\u0430\u044f \u0431\u0430\u0437\u0430 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u0430\u044f." : String(error?.message || error).slice(0, 300) }, status);
  }
}

async function handleOutbox(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!(await senderAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    const payload = await readJsonLimited(request, 64 * 1024);
    const stub = meetingState(env);
    if (Array.isArray(payload.ackIds) && payload.ackIds.length) await stub.ackMessages(payload.ackIds);
    const result = await stub.pullMessages({ limit: payload.limit || 20 });
    return json({ ok: true, botName: GROUP_CONFIG.botDisplayName, messages: result.messages || [] });
  } catch (error) {
    return json({ ok: false, error: String(error?.message || error).slice(0, 300) }, 400);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, app: GROUP_CONFIG.appName, version: "1.0.0" });
    if (url.pathname === "/zoom-only/app" && request.method === "GET") {
      if (!(await panelAuthorized(request, env))) return html("Unauthorized", 401);
      const meetingId = requestMeetingId(request);
      return html(buildPanelHtml({ teamChatTest: teamChatTestEnabled(env, meetingId) }));
    }
    if (url.pathname === "/zoom-only/app/action") return handleAppAction(request, env);
    if (url.pathname.startsWith("/zoom-only/team-chat/")) return handleTeamChat(request, env);
    if (url.pathname === "/zoom-only/library/status" || url.pathname === "/zoom-only/library/import") return handleLibrary(request, env);
    if (url.pathname === "/zoom-only/outbox") return handleOutbox(request, env);
    if (url.pathname === "/zoom-only/status") {
      if (!(await panelAuthorized(request, env)) && !(await senderAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
      return json(await meetingState(env, requestMeetingId(request)).status());
    }
    return json({ ok: false, error: "not_found" }, 404);
  }
};
