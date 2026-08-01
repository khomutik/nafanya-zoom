import { DurableObject } from "cloudflare:workers";
import {
  buildMeetingBoardText,
  buildSpeakerQuestionsText,
  createEmptyMeetingBoardState,
  createEmptySpeakerQuestionsState,
  normalizeMeetingBoardState,
  normalizeSpeakerQuestionsState,
  sanitizeBoardText,
  splitZoomMessages
} from "./meeting-board.mjs";
import { getMeetingDay } from "./group-config.mjs";

const STATE_KEY = "zoom-meeting-state";
const MAX_OUTBOX_MESSAGES = 300;

function emptyRuntimeState() {
  return {
    outbox: [],
    nextOutboxId: 1,
    lastPanelAction: null,
    meetingBoard: createEmptyMeetingBoardState(),
    speakerQuestions: createEmptySpeakerQuestionsState(),
    activeMode: null,
    lastReplayAt: 0
  };
}

function normalizeRuntimeState(value) {
  const source = value && typeof value === "object" ? value : {};
  const state = {
    ...emptyRuntimeState(),
    ...source,
    outbox: (Array.isArray(source.outbox) ? source.outbox : []).filter((item) => item?.id && item?.text).slice(-MAX_OUTBOX_MESSAGES),
    nextOutboxId: Math.max(1, Math.floor(Number(source.nextOutboxId) || 1)),
    meetingBoard: normalizeMeetingBoardState(source.meetingBoard),
    speakerQuestions: normalizeSpeakerQuestionsState(source.speakerQuestions),
    activeMode: source.activeMode === "meeting" || source.activeMode === "speaker" ? source.activeMode : null
  };
  state.lastReplayAt = Math.max(0, Number(source.lastReplayAt) || 0);
  const maxId = state.outbox.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  if (state.nextOutboxId <= maxId) state.nextOutboxId = maxId + 1;
  return state;
}

function appendMessages(state, rawMessages) {
  const createdAt = Date.now();
  const queued = (Array.isArray(rawMessages) ? rawMessages : [])
    .flatMap((message) => splitZoomMessages(message))
    .map((text) => ({ id: state.nextOutboxId++, text, createdAt }));
  if (queued.length) state.outbox = [...state.outbox, ...queued].slice(-MAX_OUTBOX_MESSAGES);
  return queued;
}

function rememberRequest(target, requestId) {
  const id = String(requestId || "").trim();
  if (!id) return false;
  if (target.processedRequestIds.includes(id)) return true;
  target.processedRequestIds = [...target.processedRequestIds, id].slice(-100);
  return false;
}

function validSessionDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(String(value || ""));
}

export class ZoomMeetingState extends DurableObject {
  async readState() {
    return normalizeRuntimeState(await this.ctx.storage.get(STATE_KEY));
  }

  async mutate(mutator) {
    return this.ctx.storage.transaction(async (transaction) => {
      const state = normalizeRuntimeState(await transaction.get(STATE_KEY));
      const result = await mutator(state);
      await transaction.put(STATE_KEY, state);
      return result;
    });
  }

  async enqueueMessages(messages) {
    return this.mutate((state) => ({ ok: true, queued: appendMessages(state, messages) }));
  }

  async getOutboxMarker() {
    const state = await this.readState();
    return { ok: true, nextId: state.nextOutboxId };
  }

  async pullMessages({ minId = 0, limit = 20 } = {}) {
    const state = await this.readState();
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    const safeMinId = Math.max(0, Number(minId) || 0);
    return { ok: true, messages: state.outbox.filter((item) => !safeMinId || item.id >= safeMinId).slice(0, safeLimit) };
  }

  async ackMessages(ids = []) {
    const accepted = new Set((Array.isArray(ids) ? ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0));
    return this.mutate((state) => {
      if (accepted.size) state.outbox = state.outbox.filter((item) => !accepted.has(item.id));
      return { ok: true, remaining: state.outbox.length };
    });
  }

  async recordPanelAction(payload = {}) {
    return this.mutate((state) => {
      const key = String(payload.key || "").trim();
      state.lastPanelAction = { key, label: String(payload.label || key), ok: payload.ok !== false, createdAt: Date.now() };
      return { ok: true, lastAction: state.lastPanelAction };
    });
  }

  async meetingBoardAction(payload = {}) {
    return this.mutate((runtime) => {
      const action = String(payload.boardAction || "publish");
      if (action === "replay") {
        const board = normalizeMeetingBoardState(runtime.meetingBoard);
        const now = Date.now();
        const currentSession = validSessionDate(payload.sessionDate) && board.sessionDate === payload.sessionDate;
        const replayable = runtime.activeMode === "meeting" && currentSession && board.lastMessages.length > 0;
        const duplicate = replayable && now - runtime.lastReplayAt < 15_000;
        const queued = replayable && !duplicate ? appendMessages(runtime, board.lastMessages) : [];
        if (queued.length) runtime.lastReplayAt = now;
        return { ok: true, duplicate, state: board, activeMode: runtime.activeMode, queued };
      }
      const sessionDate = String(payload.sessionDate || "").trim();
      const dayKey = String(payload.dayKey || "").trim();
      if (!validSessionDate(sessionDate) || !getMeetingDay(dayKey)) throw new Error("\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u0434\u0435\u043d\u044c \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f.");
      let board = normalizeMeetingBoardState(runtime.meetingBoard);
      if (board.sessionDate !== sessionDate || board.dayKey !== dayKey) board = { ...createEmptyMeetingBoardState(), sessionDate, dayKey };
      runtime.meetingBoard = board;
      if (rememberRequest(board, payload.requestId)) return { ok: true, duplicate: true, state: board, activeMode: runtime.activeMode, queued: [] };
      const now = Date.now();
      const id = String(payload.id || "").trim();
      if (action === "add_entry") {
        board.entries.push({ id: crypto.randomUUID(), text: sanitizeBoardText(payload.text), status: "waiting", createdAt: now, updatedAt: now });
      } else if (action === "add_topic") {
        const text = sanitizeBoardText(payload.text, { stripLeadingNumber: true });
        if (board.additionalTopics.some((item) => item.text === text)) throw new Error("\u0422\u0430\u043a\u0430\u044f \u0434\u043e\u043f. \u0442\u0435\u043c\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044c.");
        board.additionalTopics.push({ id: crypto.randomUUID(), text, createdAt: now, updatedAt: now });
      } else if (["mark_spoken", "restore_waiting", "defer_entry", "remove_entry"].includes(action)) {
        const index = board.entries.findIndex((item) => item.id === id);
        if (index < 0) throw new Error("\u0417\u0430\u043f\u0438\u0441\u044c \u0443\u0436\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0430. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u043f\u0438\u0441\u043e\u043a.");
        if (action === "remove_entry") board.entries.splice(index, 1);
        else if (action === "defer_entry") {
          if (board.entries[index].status === "spoken") throw new Error("\u0412\u044b\u0441\u043a\u0430\u0437\u0430\u0432\u0448\u0435\u0433\u043e\u0441\u044f \u043d\u0435\u043b\u044c\u0437\u044f \u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u043d\u0438\u0436\u0435.");
          if (index >= board.entries.length - 1) throw new Error("\u042d\u0442\u0430 \u0437\u0430\u043f\u0438\u0441\u044c \u0443\u0436\u0435 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f.");
          [board.entries[index], board.entries[index + 1]] = [board.entries[index + 1], { ...board.entries[index], updatedAt: now }];
        } else board.entries[index] = { ...board.entries[index], status: action === "mark_spoken" ? "spoken" : "waiting", updatedAt: now };
      } else if (action === "remove_topic") {
        const index = board.additionalTopics.findIndex((item) => item.id === id);
        if (index < 0) throw new Error("\u0414\u043e\u043f. \u0442\u0435\u043c\u0430 \u0443\u0436\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0430.");
        board.additionalTopics.splice(index, 1);
      } else if (action !== "publish") throw new Error("\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043e\u0447\u0435\u0440\u0435\u0434\u0438.");
      board.version += 1;
      board.updatedAt = now;
      board.lastMessages = splitZoomMessages(buildMeetingBoardText(board));
      runtime.activeMode = "meeting";
      runtime.lastReplayAt = 0;
      const queued = appendMessages(runtime, board.lastMessages);
      return { ok: true, duplicate: false, state: board, activeMode: runtime.activeMode, queued };
    });
  }

  async speakerQuestionsAction(payload = {}) {
    return this.mutate((runtime) => {
      const sessionDate = String(payload.sessionDate || "").trim();
      if (!validSessionDate(sessionDate)) throw new Error("\u041d\u0435\u0432\u0435\u0440\u043d\u0430\u044f \u0434\u0430\u0442\u0430 \u0441\u043f\u0438\u043a\u0435\u0440\u0441\u043a\u043e\u0439.");
      let speaker = normalizeSpeakerQuestionsState(runtime.speakerQuestions);
      if (speaker.sessionDate !== sessionDate) speaker = { ...createEmptySpeakerQuestionsState(), sessionDate };
      runtime.speakerQuestions = speaker;
      if (rememberRequest(speaker, payload.requestId)) return { ok: true, duplicate: true, state: speaker, activeMode: runtime.activeMode, queued: [] };
      const action = String(payload.speakerAction || "publish");
      const now = Date.now();
      if (action === "add") speaker.entries.push({ id: crypto.randomUUID(), text: sanitizeBoardText(payload.text), createdAt: now, updatedAt: now });
      else if (action === "remove") {
        const index = speaker.entries.findIndex((item) => item.id === String(payload.id || ""));
        if (index < 0) throw new Error("\u0417\u0430\u043f\u0438\u0441\u044c \u0441\u043f\u0438\u043a\u0435\u0440\u0441\u043a\u043e\u0439 \u0443\u0436\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0430.");
        speaker.entries.splice(index, 1);
      } else if (action === "clear") speaker.entries = [];
      else if (action !== "publish") throw new Error("\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0441\u043f\u0438\u043a\u0435\u0440\u0441\u043a\u043e\u0439.");
      speaker.version += 1;
      speaker.updatedAt = now;
      speaker.lastMessages = splitZoomMessages(buildSpeakerQuestionsText(speaker));
      runtime.activeMode = "speaker";
      const queued = appendMessages(runtime, speaker.lastMessages);
      return { ok: true, duplicate: false, state: speaker, activeMode: runtime.activeMode, queued };
    });
  }

  async status() {
    const state = await this.readState();
    return {
      ok: true,
      outboxSize: state.outbox.length,
      nextOutboxId: state.nextOutboxId,
      lastPanelAction: state.lastPanelAction,
      meetingBoard: state.meetingBoard,
      speakerQuestions: state.speakerQuestions,
      activeMode: state.activeMode
    };
  }
}
