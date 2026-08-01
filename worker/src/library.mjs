export const ZOOM_LIBRARY_SCHEMA_VERSION = 1;
export const ZOOM_LIBRARY_CURRENT_KEY = "zoom-library/current.json";
export const ZOOM_LIBRARY_PREVIOUS_KEY = "zoom-library/previous.json";
export const ZOOM_LIBRARY_IMPORT_MAX_BYTES = 8 * 1024 * 1024;
export const ZOOM_LIBRARY_SOURCE_TARGET = 950;
export const ZOOM_LIBRARY_MESSAGE_LIMIT = 950;
export const ZOOM_PART_MARKER = /\s*<!--\s*zoom-part\s*-->\s*/giu;

export const ZOOM_LIBRARY_COLLECTIONS = Object.freeze({
  big_book: Object.freeze({ label: "\u0411\u043e\u043b\u044c\u0448\u0430\u044f \u043a\u043d\u0438\u0433\u0430", kind: "numbered", minCount: 1 }),
  twelve_twelve: Object.freeze({ label: "12 \u0448\u0430\u0433\u043e\u0432 \u0438 12 \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u0439", kind: "numbered", minCount: 1 }),
  living_sober: Object.freeze({ label: "\u0416\u0438\u0442\u044c \u0442\u0440\u0435\u0437\u0432\u044b\u043c\u0438", kind: "numbered", minCount: 1 }),
  daily_reflections: Object.freeze({ label: "\u0415\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u044f", kind: "dated", expectedCount: 366 }),
  as_bill_sees_it: Object.freeze({ label: "\u041a\u0430\u043a \u044d\u0442\u043e \u0432\u0438\u0434\u0438\u0442 \u0411\u0438\u043b\u043b", kind: "numbered", expectedCount: 332 }),
  game_questions: Object.freeze({ label: "\u0412\u043e\u043f\u0440\u043e\u0441\u044b \u0438\u0433\u0440\u044b", kind: "numbered", expectedCount: 500 })
});

export const ZOOM_LIBRARY_REBALANCED_COLLECTIONS = Object.freeze(["big_book", "twelve_twelve", "living_sober"]);

export function unicodeLength(value) {
  return Array.from(String(value || "")).length;
}

export function normalizeLibraryText(value) {
  let text = String(value || "").replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").replace(/\u0000/gu, "");
  if (/^---\s*\n/u.test(text)) {
    text = text.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/u, "");
  }
  return text
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n{4,}/gu, "\n\n\n")
    .trim();
}

export function stripEmbeddedLibraryHeader(collectionId, value) {
  const text = normalizeLibraryText(value);
  if (!text) return text;
  const [firstLine, ...remainingLines] = text.split("\n");
  let replacement = null;
  if (collectionId === "as_bill_sees_it" && /^\u041a\u0430\u043a \u044d\u0442\u043e \u0432\u0438\u0434\u0438\u0442 \u0411\u0438\u043b\u043b\s*[\u00b7\u2022]\s*\u2116\s*0*\d+\s*$/iu.test(firstLine)) {
    replacement = "";
  } else if (collectionId === "daily_reflections" && /^\u0415\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u044f\s*[\u00b7\u2022]\s*\d{1,2}[.]\d{1,2}(?:\s*[\u00b7\u2022]\s*\u2116\s*0*\d+)?\s*$/iu.test(firstLine)) {
    replacement = "";
  } else if (collectionId === "game_questions" && /^\u0412\u043e\u043f\u0440\u043e\u0441 (?:\u0434\u043b\u044f )?\u0438\u0433\u0440\u044b\s*[\u00b7\u2022]\s*\u2116\s*0*\d+\s*$/iu.test(firstLine)) {
    replacement = "";
  } else if (collectionId === "twelve_twelve") {
    const match = firstLine.match(/^12\s*[\u00d7x\u0445]\s*12\s*[\u00b7\u2022]\s*(.*?)\s*[\u00b7\u2022]\s*\u2116\s*0*\d+\s*$/iu);
    if (match) replacement = match[1].trim();
  } else if (collectionId === "living_sober") {
    const match = firstLine.match(/^\u0416\u0418\u0422\u042c \u0422\u0420\u0415\u0417\u0412\u042b\u041c\u0418\s*[\u00b7\u2022]\s*(.*?)\s*[\u00b7\u2022]\s*\u2116\s*0*\d+\s*$/iu);
    if (match) replacement = match[1].trim();
  }
  if (replacement === null) return text;
  return normalizeLibraryText([replacement, ...remainingLines].join("\n"));
}

function normalizeDateKey(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})[.-](\d{1,2})$/u);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const key = `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}`;
  const probe = new Date(Date.UTC(2024, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day ? key : null;
}

function normalizeNumberKey(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 9999 ? String(number) : null;
}

function collectionEntries(rawCollection) {
  if (Array.isArray(rawCollection?.entries)) return rawCollection.entries;
  if (rawCollection?.entries && typeof rawCollection.entries === "object") {
    return Object.entries(rawCollection.entries).map(([key, value]) => ({ key, text: typeof value === "string" ? value : value?.text, sourcePath: value?.sourcePath || "" }));
  }
  return [];
}

function missingNumberKeys(entries) {
  const numbers = Object.keys(entries).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  if (!numbers.length) return [];
  const available = new Set(numbers);
  const missing = [];
  for (let number = 1; number <= numbers.at(-1); number += 1) {
    if (!available.has(number)) missing.push(number);
  }
  return missing;
}

export function validateLibraryImport(payload, { requireEveryCollection = false } = {}) {
  const errors = [];
  const warnings = [];
  const sourceCollections = payload?.collections && typeof payload.collections === "object" ? payload.collections : {};
  const normalized = {};
  for (const [collectionId, rawCollection] of Object.entries(sourceCollections)) {
    const definition = ZOOM_LIBRARY_COLLECTIONS[collectionId];
    if (!definition) {
      errors.push(`\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043a\u043e\u043b\u043b\u0435\u043a\u0446\u0438\u044f: ${collectionId}`);
      continue;
    }
    let entries = {};
    const seen = new Set();
    for (const item of collectionEntries(rawCollection)) {
      const key = definition.kind === "dated" ? normalizeDateKey(item?.key) : normalizeNumberKey(item?.key);
      if (!key) {
        errors.push(`${definition.label}: \u043d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u043d\u043e\u043c\u0435\u0440/\u0434\u0430\u0442\u0430 ${String(item?.key || "")}`);
        continue;
      }
      if (seen.has(key)) {
        errors.push(`${definition.label}: \u0434\u0443\u0431\u043b\u044c ${key}`);
        continue;
      }
      seen.add(key);
      const text = stripEmbeddedLibraryHeader(collectionId, item?.text);
      if (!text) {
        errors.push(`${definition.label}: \u043f\u0443\u0441\u0442\u043e\u0439 \u043e\u0442\u0440\u044b\u0432\u043e\u043a ${key}`);
        continue;
      }
      entries[key] = { text, sourcePath: String(item?.sourcePath || "").slice(0, 500) };
    }
    const sourceCount = Object.keys(entries).length;
    if (definition.kind === "numbered") {
      const missing = missingNumberKeys(entries);
      if (missing.length) errors.push(`${definition.label}: \u043f\u0440\u043e\u043f\u0443\u0449\u0435\u043d\u044b \u043d\u043e\u043c\u0435\u0440\u0430 ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? "..." : ""}`);
    }
    if (ZOOM_LIBRARY_REBALANCED_COLLECTIONS.includes(collectionId) && sourceCount) {
      entries = rebalanceNumberedBookEntries(collectionId, entries);
      const packedCount = Object.keys(entries).length;
      if (packedCount !== sourceCount) warnings.push(`${definition.label}: \u043e\u0442\u0440\u044b\u0432\u043a\u0438 \u043f\u0435\u0440\u0435\u043d\u0430\u0440\u0435\u0437\u0430\u043d\u044b \u043f\u043e \u0437\u0430\u043a\u043e\u043d\u0447\u0435\u043d\u043d\u044b\u043c \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u044f\u043c: ${sourceCount} \u2192 ${packedCount}`);
    }
    const count = Object.keys(entries).length;
    if (!count) errors.push(`${definition.label}: \u043d\u0435\u0442 \u043e\u0442\u0440\u044b\u0432\u043a\u043e\u0432`);
    if (definition.expectedCount && count !== definition.expectedCount) {
      errors.push(`${definition.label}: \u043e\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044f ${definition.expectedCount}, \u043d\u0430\u0439\u0434\u0435\u043d\u043e ${count}`);
    }
    if (definition.minCount && count < definition.minCount) errors.push(`${definition.label}: \u043d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e \u043e\u0442\u0440\u044b\u0432\u043a\u043e\u0432`);
    const longEntries = Object.entries(entries).filter(([, entry]) => unicodeLength(entry.text) > ZOOM_LIBRARY_SOURCE_TARGET).length;
    if (longEntries) warnings.push(`${definition.label}: ${longEntries} \u0442\u0435\u043a\u0441\u0442\u043e\u0432 \u0434\u043b\u0438\u043d\u043d\u0435\u0435 950 \u0437\u043d\u0430\u043a\u043e\u0432; \u043e\u043d\u0438 \u0431\u0443\u0434\u0443\u0442 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u0440\u0430\u0437\u0434\u0435\u043b\u0435\u043d\u044b, \u0438\u0442\u043e\u0433\u043e\u0432\u044b\u0439 \u043b\u0438\u043c\u0438\u0442 \u0432\u043c\u0435\u0441\u0442\u0435 \u0441 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u043e\u043c \u2014 950`);
    normalized[collectionId] = { label: definition.label, kind: definition.kind, entries };
  }
  if (!Object.keys(normalized).length) errors.push("\u041d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e \u043d\u0438 \u043e\u0434\u043d\u043e\u0439 \u043a\u043d\u0438\u0433\u0438 \u0438\u043b\u0438 \u0431\u0430\u0437\u044b \u0432\u043e\u043f\u0440\u043e\u0441\u043e\u0432.");
  if (requireEveryCollection) {
    for (const [collectionId, definition] of Object.entries(ZOOM_LIBRARY_COLLECTIONS)) {
      if (!normalized[collectionId]) errors.push(`${definition.label}: \u043a\u043e\u043b\u043b\u0435\u043a\u0446\u0438\u044f \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430`);
    }
  }
  const preview = { totalEntries: 0, totalMessages: 0, multipartEntries: 0, maxMessageLength: 0, collections: {} };
  for (const [collectionId, collection] of Object.entries(normalized)) {
    const collectionPreview = { entries: 0, messages: 0, multipartEntries: 0 };
    for (const [key, entry] of Object.entries(collection.entries)) {
      const messages = buildLibraryZoomMessages(collectionId, key, entry.text);
      collectionPreview.entries += 1;
      collectionPreview.messages += messages.length;
      if (messages.length > 1) collectionPreview.multipartEntries += 1;
      for (const message of messages) preview.maxMessageLength = Math.max(preview.maxMessageLength, unicodeLength(message));
    }
    preview.totalEntries += collectionPreview.entries;
    preview.totalMessages += collectionPreview.messages;
    preview.multipartEntries += collectionPreview.multipartEntries;
    preview.collections[collectionId] = collectionPreview;
  }
  return { ok: errors.length === 0, errors, warnings, collections: normalized, preview };
}

export function mergeLibraryCollections(currentLibrary, importedCollections, { publishedAt = new Date().toISOString(), version = crypto.randomUUID() } = {}) {
  const currentCollections = currentLibrary?.collections && typeof currentLibrary.collections === "object" ? currentLibrary.collections : {};
  return {
    schemaVersion: ZOOM_LIBRARY_SCHEMA_VERSION,
    version,
    publishedAt,
    collections: { ...currentCollections, ...importedCollections }
  };
}

export function getLibraryStatus(library) {
  const collections = {};
  for (const [collectionId, definition] of Object.entries(ZOOM_LIBRARY_COLLECTIONS)) {
    const entries = library?.collections?.[collectionId]?.entries || {};
    collections[collectionId] = { label: definition.label, count: Object.keys(entries).length, available: Object.keys(entries).length > 0 };
  }
  return {
    available: Boolean(library && library.schemaVersion === ZOOM_LIBRARY_SCHEMA_VERSION),
    complete: Object.values(collections).every((item) => item.available),
    schemaVersion: library?.schemaVersion || null,
    version: library?.version || null,
    publishedAt: library?.publishedAt || null,
    collections
  };
}

export async function readZoomLibrary(env) {
  if (!env?.ZOOM_LIBRARY) throw new Error("\u0425\u0440\u0430\u043d\u0438\u043b\u0438\u0449\u0435 \u043a\u043d\u0438\u0436\u043d\u043e\u0439 \u0431\u0430\u0437\u044b \u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u043e.");
  const object = await env.ZOOM_LIBRARY.get(ZOOM_LIBRARY_CURRENT_KEY);
  if (!object) return null;
  const library = await object.json();
  if (!library || library.schemaVersion !== ZOOM_LIBRARY_SCHEMA_VERSION || typeof library.collections !== "object") {
    throw new Error("\u041a\u043d\u0438\u0436\u043d\u0430\u044f \u0431\u0430\u0437\u0430 \u043f\u043e\u0432\u0440\u0435\u0436\u0434\u0435\u043d\u0430.");
  }
  return library;
}

export async function saveZoomLibrary(env, library) {
  if (!env?.ZOOM_LIBRARY) throw new Error("\u0425\u0440\u0430\u043d\u0438\u043b\u0438\u0449\u0435 \u043a\u043d\u0438\u0436\u043d\u043e\u0439 \u0431\u0430\u0437\u044b \u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u043e.");
  const serialized = JSON.stringify(library);
  if (new TextEncoder().encode(serialized).byteLength > ZOOM_LIBRARY_IMPORT_MAX_BYTES) throw new Error("\u041a\u043d\u0438\u0436\u043d\u0430\u044f \u0431\u0430\u0437\u0430 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u0430\u044f.");
  const current = await env.ZOOM_LIBRARY.get(ZOOM_LIBRARY_CURRENT_KEY);
  if (current) {
    await env.ZOOM_LIBRARY.put(ZOOM_LIBRARY_PREVIOUS_KEY, current.body, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  }
  await env.ZOOM_LIBRARY.put(ZOOM_LIBRARY_CURRENT_KEY, serialized, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  return library;
}

function semanticSplit(value, maxLength) {
  const chunks = [];
  let rest = normalizeLibraryText(value);
  while (unicodeLength(rest) > maxLength) {
    const codepoints = Array.from(rest);
    const candidate = codepoints.slice(0, maxLength).join("");
    const breaks = [candidate.lastIndexOf("\n\n"), candidate.lastIndexOf("\n"), candidate.lastIndexOf(". "), candidate.lastIndexOf(" ")];
    const best = Math.max(...breaks);
    const prefix = best >= Math.floor(candidate.length * 0.55) ? candidate.slice(0, best + (candidate.slice(best, best + 2) === ". " ? 1 : 0)) : candidate;
    const cut = Math.max(1, unicodeLength(prefix));
    chunks.push(codepoints.slice(0, cut).join("").trim());
    rest = codepoints.slice(cut).join("").trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

function baseEntryHeader(collectionId, key) {
  const definition = ZOOM_LIBRARY_COLLECTIONS[collectionId];
  if (!definition) return "";
  if (collectionId === "game_questions") return `\u0412\u043e\u043f\u0440\u043e\u0441 \u0438\u0433\u0440\u044b \u2116${key}`;
  if (definition.kind === "dated") return `${definition.label}. ${key}`;
  return `${definition.label}. \u041e\u0442\u0440\u044b\u0432\u043e\u043a \u2116${key}`;
}

function lastSentenceBoundary(value) {
  const matches = [...String(value || "").matchAll(/[.!?\u2026][\u00bb\u201d"'\u2019)\]]*(?=\s|$)/gu)];
  const match = matches.at(-1);
  return match ? match.index + match[0].length : 0;
}

function endsWithSentenceBoundary(value) {
  return /[.!?\u2026][\u00bb\u201d"'\u2019)\]]*$/u.test(String(value || "").trim());
}

function dedupeRepeatedStandaloneHeadings(value) {
  const seen = new Set();
  return normalizeLibraryText(value)
    .split("\n")
    .filter((line) => {
      const heading = line.trim();
      const looksLikeHeading = heading.length >= 3
        && heading.length <= 120
        && /[A-Z\u0410-\u042f\u0401]/u.test(heading)
        && heading === heading.toLocaleUpperCase("ru-RU")
        && !/[.!?\u2026]$/u.test(heading);
      if (!looksLikeHeading) return true;
      const key = heading.replace(/\s+/gu, " ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n");
}

export function rebalanceNumberedBookEntries(collectionId, rawEntries, limit = ZOOM_LIBRARY_MESSAGE_LIMIT) {
  if (!ZOOM_LIBRARY_REBALANCED_COLLECTIONS.includes(collectionId)) return rawEntries;
  const ordered = Object.entries(rawEntries || {}).sort(([left], [right]) => Number(left) - Number(right));
  const sourcePath = ordered.length ? `rebalance:${ordered[0][0]}-${ordered.at(-1)[0]}` : "rebalance";
  const sourceParts = ordered.map(([, entry]) => stripEmbeddedLibraryHeader(collectionId, entry?.text).replace(ZOOM_PART_MARKER, "\n\n")).filter(Boolean);
  let combined = "";
  for (const sourcePart of sourceParts) {
    if (!combined) combined = sourcePart;
    else combined += `${endsWithSentenceBoundary(combined) ? "\n\n" : " "}${sourcePart}`;
  }
  let rest = normalizeLibraryText(dedupeRepeatedStandaloneHeadings(combined));
  const entries = {};
  let number = 1;
  while (rest) {
    const header = baseEntryHeader(collectionId, String(number));
    const bodyLimit = limit - unicodeLength(`${header}\n\n`);
    if (bodyLimit < 100) throw new Error("\u0421\u043b\u0438\u0448\u043a\u043e\u043c \u0434\u043b\u0438\u043d\u043d\u044b\u0439 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a.");
    if (unicodeLength(rest) <= bodyLimit) {
      entries[String(number)] = { text: rest, sourcePath };
      break;
    }
    const candidate = Array.from(rest).slice(0, bodyLimit).join("");
    const boundary = lastSentenceBoundary(candidate);
    if (!boundary) throw new Error(`${ZOOM_LIBRARY_COLLECTIONS[collectionId].label}: \u043d\u0430\u0439\u0434\u0435\u043d\u043e \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0434\u043b\u0438\u043d\u043d\u0435\u0435 \u0434\u043e\u043f\u0443\u0441\u0442\u0438\u043c\u043e\u0433\u043e Zoom-\u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f.`);
    entries[String(number)] = { text: candidate.slice(0, boundary).trim(), sourcePath };
    rest = normalizeLibraryText(rest.slice(boundary));
    number += 1;
  }
  return entries;
}

export function buildLibraryZoomMessages(collectionId, key, rawText, limit = ZOOM_LIBRARY_MESSAGE_LIMIT) {
  const definition = ZOOM_LIBRARY_COLLECTIONS[collectionId];
  if (!definition) throw new Error("\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043a\u043d\u0438\u0433\u0430.");
  const normalizedKey = definition.kind === "dated" ? normalizeDateKey(key) : normalizeNumberKey(key);
  if (!normalizedKey) throw new Error("\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u043d\u043e\u043c\u0435\u0440 \u0438\u043b\u0438 \u0434\u0430\u0442\u0430.");
  const text = stripEmbeddedLibraryHeader(collectionId, rawText);
  if (!text) throw new Error("\u041e\u0442\u0440\u044b\u0432\u043e\u043a \u043f\u0443\u0441\u0442.");
  const header = baseEntryHeader(collectionId, normalizedKey);
  const explicitParts = text.split(ZOOM_PART_MARKER).map(normalizeLibraryText).filter(Boolean);
  if (explicitParts.length === 1 && unicodeLength(`${header}\n\n${explicitParts[0]}`) <= limit) return [`${header}\n\n${explicitParts[0]}`];
  const messages = [];
  for (const explicitPart of explicitParts) {
    const firstBodyLimit = limit - unicodeLength(`${header}\n\n`);
    if (!messages.length && firstBodyLimit < 100) throw new Error("\u0421\u043b\u0438\u0448\u043a\u043e\u043c \u0434\u0438\u043d\u043d\u044b\u0439 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a.");
    const bodies = semanticSplit(explicitPart, messages.length ? limit : firstBodyLimit);
    for (const body of bodies) {
      messages.push(messages.length ? body : `${header}\n\n${body}`);
    }
  }
  if (messages.some((message) => unicodeLength(message) > limit)) throw new Error("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e \u0440\u0430\u0437\u0434\u0435\u043b\u0438\u0442\u044c \u0442\u0435\u043a\u0441\u0442.");
  return messages;
}

export function getLibraryEntry(library, collectionId, key) {
  const definition = ZOOM_LIBRARY_COLLECTIONS[collectionId];
  if (!definition) return null;
  const normalizedKey = definition.kind === "dated" ? normalizeDateKey(key) : normalizeNumberKey(key);
  if (!normalizedKey) return null;
  return library?.collections?.[collectionId]?.entries?.[normalizedKey] || null;
}
