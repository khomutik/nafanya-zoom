import { GROUP_CONFIG, getMeetingButton } from "./group-config.mjs";
import { ZoomMeetingState } from "./meeting-state.mjs";
import { ZoomSharedTimerState } from "./timer-state.mjs";
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

export { ZoomMeetingState, ZoomSharedTimerState };

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

function meetingState(env) {
  return env.ZOOM_MEETING_STATE.getByName(instanceName(env));
}

function timerState(env) {
  return env.ZOOM_SHARED_TIMER_STATE.getByName(instanceName(env));
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
  meeting_board_replay: "replay"
});

const SPEAKER_ACTIONS = Object.freeze({
  speaker_questions_publish: "publish",
  speaker_questions_add: "add",
  speaker_questions_remove: "remove",
  speaker_questions_clear: "clear"
});

async function handleAppAction(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!(await panelAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
  try {
    const payload = await readJsonLimited(request, 64 * 1024);
    const stub = meetingState(env);
    if (BOARD_ACTIONS[payload.action]) {
      const result = await stub.meetingBoardAction({ ...payload, boardAction: BOARD_ACTIONS[payload.action], sessionDate: sessionDate() });
      return json({ ...result, message: result.duplicate ? "\u041d\u0430\u0436\u0430\u0442\u0438\u0435 \u0443\u0436\u0435 \u0443\u0447\u0442\u0435\u043d\u043e." : "\u0410\u043a\u0442\u0443\u0430\u043b\u044c\u043d\u043e\u0435 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u0432 Zoom." });
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
      return html(buildPanelHtml());
    }
    if (url.pathname === "/zoom-only/app/action") return handleAppAction(request, env);
    if (url.pathname === "/zoom-only/library/status" || url.pathname === "/zoom-only/library/import") return handleLibrary(request, env);
    if (url.pathname === "/zoom-only/outbox") return handleOutbox(request, env);
    if (url.pathname === "/zoom-only/status") {
      if (!(await panelAuthorized(request, env)) && !(await senderAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
      return json(await meetingState(env).status());
    }
    return json({ ok: false, error: "not_found" }, 404);
  }
};
