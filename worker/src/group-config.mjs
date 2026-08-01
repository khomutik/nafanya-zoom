import rawConfig from "../../config/group.json" with { type: "json" };

const DAY_KEY = /^[a-z][a-z0-9_-]{1,31}$/u;

function cleanText(value, fallback = "") {
  return String(value ?? fallback).replace(/\r\n?/gu, "\n").trim();
}

function cleanKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!DAY_KEY.test(key)) throw new Error("Invalid key in config/group.json");
  return key;
}

export function normalizeGroupConfig(value = rawConfig) {
  const source = value && typeof value === "object" ? value : {};
  const days = (Array.isArray(source.meetingDays) ? source.meetingDays : []).map((item) => ({
    key: cleanKey(item?.key),
    label: cleanText(item?.label, item?.key),
    topicText: cleanText(item?.topicText),
    collections: [...new Set((Array.isArray(item?.collections) ? item.collections : []).map(String).filter(Boolean))]
  }));
  if (!days.length) throw new Error("config/group.json must contain meetingDays");
  if (new Set(days.map((item) => item.key)).size !== days.length) throw new Error("Duplicate meeting day key in config/group.json");
  const buttons = (Array.isArray(source.meetingButtons) ? source.meetingButtons : []).map((item) => ({
    key: cleanKey(item?.key),
    label: cleanText(item?.label, item?.key),
    contexts: (Array.isArray(item?.contexts) ? item.contexts : ["meeting"]).filter((item) => item === "meeting" || item === "speaker"),
    messages: (Array.isArray(item?.text) ? item.text : [item?.text]).map((part) => cleanText(part)).filter(Boolean)
  }));
  return Object.freeze({
    appName: cleanText(source.appName, "Nafanya Zoom Bridge"),
    botDisplayName: cleanText(source.botDisplayName, "Nafanya (bot)"),
    timeZone: cleanText(source.timeZone, "Europe/Moscow"),
    messageLimit: Math.max(200, Math.min(950, Number(source.messageLimit) || 950)),
    meetingDays: Object.freeze(days),
    meetingButtons: Object.freeze(buttons),
    speaker: Object.freeze({
      label: cleanText(source.speaker?.label, "Speaker meeting"),
      buttonLabel: cleanText(source.speaker?.buttonLabel, "Speaker questions"),
      intro: cleanText(source.speaker?.intro, "SPEAKER QUESTIONS")
    }),
    testMessage: cleanText(source.testMessage, "Zoom test message")
  });
}

export const GROUP_CONFIG = normalizeGroupConfig();

export function getMeetingDay(dayKey) {
  return GROUP_CONFIG.meetingDays.find((item) => item.key === String(dayKey || "")) || null;
}

export function getMeetingButton(key) {
  return GROUP_CONFIG.meetingButtons.find((item) => item.key === String(key || "")) || null;
}
