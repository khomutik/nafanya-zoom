import { GROUP_CONFIG, getMeetingDay } from "./group-config.mjs";

export const MEETING_BOARD_TEXT_LIMIT = 300;

export function unicodeLength(value) {
  return Array.from(String(value || "")).length;
}

export function createEmptyMeetingBoardState() {
  return { sessionDate: "", dayKey: "", version: 0, entries: [], additionalTopics: [], lastMessages: [], processedRequestIds: [], updatedAt: 0 };
}

export function createEmptySpeakerQuestionsState() {
  return { sessionDate: "", version: 0, entries: [], lastMessages: [], processedRequestIds: [], updatedAt: 0 };
}

function normalizeRequestIds(value) {
  return (Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean).slice(-100);
}

export function normalizeMeetingBoardState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...createEmptyMeetingBoardState(),
    ...source,
    entries: (Array.isArray(source.entries) ? source.entries : []).filter((item) => item?.id && item?.text).map((item) => ({ ...item, status: item.status === "spoken" ? "spoken" : "waiting" })),
    additionalTopics: (Array.isArray(source.additionalTopics) ? source.additionalTopics : []).filter((item) => item?.id && item?.text),
    lastMessages: (Array.isArray(source.lastMessages) ? source.lastMessages : []).map(String).filter(Boolean),
    processedRequestIds: normalizeRequestIds(source.processedRequestIds)
  };
}

export function normalizeSpeakerQuestionsState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...createEmptySpeakerQuestionsState(),
    ...source,
    entries: (Array.isArray(source.entries) ? source.entries : []).filter((item) => item?.id && item?.text),
    lastMessages: (Array.isArray(source.lastMessages) ? source.lastMessages : []).map(String).filter(Boolean),
    processedRequestIds: normalizeRequestIds(source.processedRequestIds)
  };
}

export function sanitizeBoardText(value, { stripLeadingNumber = false } = {}) {
  const raw = String(value || "");
  if (!raw.trim()) throw new Error("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0441\u0442.");
  if (/[\u0000-\u001F\u007F<>]/u.test(raw)) throw new Error("\u0417\u0430\u043f\u0438\u0441\u044c \u0434\u043e\u043b\u0436\u043d\u0430 \u0431\u044b\u0442\u044c \u043e\u0434\u043d\u043e\u0439 \u0441\u0442\u0440\u043e\u043a\u043e\u0439.");
  let text = raw.replace(/\s+/gu, " ").trim();
  if (stripLeadingNumber) text = text.replace(/^\d{1,3}[.)]\s*/u, "").trim();
  if (!text) throw new Error("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0441\u0442.");
  if (unicodeLength(text) > MEETING_BOARD_TEXT_LIMIT) throw new Error("\u041e\u0434\u043d\u0430 \u0437\u0430\u043f\u0438\u0441\u044c \u043c\u043e\u0436\u0435\u0442 \u0441\u043e\u0434\u0435\u0440\u0436\u0430\u0442\u044c \u043d\u0435 \u0431\u043e\u043b\u0435\u0435 300 \u0437\u043d\u0430\u043a\u043e\u0432.");
  return text;
}

export function splitZoomMessages(value, limit = GROUP_CONFIG.messageLimit) {
  let rest = String(value || "").replace(/\r\n?/gu, "\n").replace(/[ \t]+\n/gu, "\n").replace(/\n{4,}/gu, "\n\n\n").trim();
  if (!rest) return [];
  const chunks = [];
  while (unicodeLength(rest) > limit) {
    const codepoints = Array.from(rest);
    const candidate = codepoints.slice(0, limit).join("");
    const boundaries = [...candidate.matchAll(/[.!?\u2026][\u00bb\u201d"'\u2019)\]]*(?=\s|$)/gu)];
    const sentence = boundaries.at(-1);
    const paragraph = candidate.lastIndexOf("\n\n");
    const line = candidate.lastIndexOf("\n");
    const word = candidate.lastIndexOf(" ");
    const preferred = Math.max(sentence ? sentence.index + sentence[0].length : -1, paragraph, line);
    const fallback = word >= Math.floor(limit * 0.55) ? word : limit;
    const cut = Math.max(1, preferred >= Math.floor(limit * 0.55) ? unicodeLength(candidate.slice(0, preferred)) : fallback);
    chunks.push(codepoints.slice(0, cut).join("").trim());
    rest = codepoints.slice(cut).join("").trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function buildMeetingBoardText(state) {
  const board = normalizeMeetingBoardState(state);
  const day = getMeetingDay(board.dayKey);
  if (!day?.topicText) throw new Error("\u041d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d \u0442\u0435\u043a\u0441\u0442 \u0442\u0435\u043c \u0434\u043b\u044f \u044d\u0442\u043e\u0433\u043e \u0434\u043d\u044f.");
  const topics = board.additionalTopics.map((item, index) => `${index + 1}. ${item.text}`);
  const queue = board.entries.length
    ? board.entries.map((item, index) => `${index + 1}. ${item.status === "spoken" ? "\u2705 " : ""}${item.text}`)
    : ["\u041f\u043e\u043a\u0430 \u0437\u0430\u044f\u0432\u043e\u043a \u043d\u0435\u0442."];
  return [day.topicText, topics.join("\n"), "\u041e\u0427\u0415\u0420\u0415\u0414\u042c \u041e\u0422\u041a\u0420\u042b\u0422\u0410:", queue.join("\n")].filter(Boolean).join("\n\n");
}

export function buildSpeakerQuestionsText(state) {
  const speaker = normalizeSpeakerQuestionsState(state);
  const lines = speaker.entries.map((item, index) => `${index + 1}. ${item.text}`);
  return [GROUP_CONFIG.speaker.intro, lines.join("\n")].filter(Boolean).join("\n\n");
}
