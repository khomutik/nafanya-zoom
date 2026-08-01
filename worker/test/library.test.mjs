import { describe, expect, it } from "vitest";
import { buildLibraryZoomMessages, rebalanceNumberedBookEntries, unicodeLength, validateLibraryImport } from "../src/library.mjs";

describe("Zoom library", () => {
  it("keeps every final message within 950 Unicode characters without part labels", () => {
    const text = `${"\u042d\u0442\u043e \u0434\u043b\u0438\u043d\u043d\u043e\u0435 \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u0435. ".repeat(120)}`;
    const messages = buildLibraryZoomMessages("as_bill_sees_it", 1, text);
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => unicodeLength(message) <= 950)).toBe(true);
    expect(messages.join("\n")).not.toMatch(/\u0427\u0430\u0441\u0442\u044c \d/u);
  });

  it("rebalances selected books at sentence boundaries", () => {
    const entries = { 1: { text: "\u041f\u0435\u0440\u0432\u043e\u0435 \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u0435. ".repeat(30) }, 2: { text: "\u0412\u0442\u043e\u0440\u043e\u0435 \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u0435. ".repeat(30) } };
    const packed = rebalanceNumberedBookEntries("big_book", entries);
    for (const [key, entry] of Object.entries(packed)) {
      expect(entry.text).toMatch(/[.!?\u2026]$/u);
      expect(unicodeLength(buildLibraryZoomMessages("big_book", key, entry.text)[0])).toBeLessThanOrEqual(950);
    }
  });

  it("does not carry a repeated chapter heading into every new excerpt", () => {
    const entries = {
      1: { text: "\u0428\u0410\u0413 \u0427\u0415\u0422\u0412\u0401\u0420\u0422\u042b\u0419\n\n\u041f\u0435\u0440\u0432\u043e\u0435 \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u0435." },
      2: { text: "\u0428\u0410\u0413 \u0427\u0415\u0422\u0412\u0401\u0420\u0422\u042b\u0419\n\n\u0412\u0442\u043e\u0440\u043e\u0435 \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u0435." }
    };
    const packed = rebalanceNumberedBookEntries("twelve_twelve", entries);
    const combined = Object.values(packed).map((entry) => entry.text).join("\n");
    expect(combined.match(/\u0428\u0410\u0413 \u0427\u0415\u0422\u0412\u0401\u0420\u0422\u042b\u0419/gu)).toHaveLength(1);
  });

  it("removes embedded book headers and adds the final header only once", () => {
    const bill = buildLibraryZoomMessages("as_bill_sees_it", 96, "\u041a\u0430\u043a \u044d\u0442\u043e \u0432\u0438\u0434\u0438\u0442 \u0411\u0438\u043b\u043b \u00b7 \u2116 096\n\n\u0422\u0435\u043a\u0441\u0442.");
    const daily = buildLibraryZoomMessages("daily_reflections", "31.07", "\u0415\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u044f \u00b7 31.07 \u00b7 \u2116 213\n\n\u0422\u0435\u043a\u0441\u0442.");
    const game = buildLibraryZoomMessages("game_questions", 63, "\u0412\u043e\u043f\u0440\u043e\u0441 \u0434\u043b\u044f \u0438\u0433\u0440\u044b \u00b7 \u2116 063\n\n\u0422\u0435\u043a\u0441\u0442.");
    expect(bill.join("\n").match(/\u041a\u0430\u043a \u044d\u0442\u043e \u0432\u0438\u0434\u0438\u0442 \u0411\u0438\u043b\u043b/gu)).toHaveLength(1);
    expect(daily.join("\n").match(/\u0415\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u044f/gu)).toHaveLength(1);
    expect(daily.join("\n")).not.toMatch(/\u2116\s*213/u);
    expect(game.join("\n").match(/\u0412\u043e\u043f\u0440\u043e\u0441 (?:\u0434\u043b\u044f )?\u0438\u0433\u0440\u044b/gu)).toHaveLength(1);
  });

  it("honors manual markers without part labels and fills the exact 950 boundary", () => {
    const header = "\u0411\u043e\u043b\u044c\u0448\u0430\u044f \u043a\u043d\u0438\u0433\u0430. \u041e\u0442\u0440\u044b\u0432\u043e\u043a \u21161";
    const exactBody = "a".repeat(950 - unicodeLength(`${header}\n\n`));
    const exact = buildLibraryZoomMessages("big_book", 1, exactBody);
    expect(exact).toHaveLength(1);
    expect(unicodeLength(exact[0])).toBe(950);
    const marked = buildLibraryZoomMessages("as_bill_sees_it", 1, `${"\ud83e\udd94".repeat(700)}\n\n<!-- zoom-part -->\n\n${"\ud83c\udf3f".repeat(700)}`);
    expect(marked.length).toBeGreaterThan(1);
    expect(marked.every((message) => unicodeLength(message) <= 950)).toBe(true);
    expect(marked.join("\n")).not.toMatch(/\u0427\u0430\u0441\u0442\u044c\s+\d/iu);
  });

  it("rejects duplicates, gaps and empty files before publication", () => {
    const validation = validateLibraryImport({ collections: { big_book: { entries: [{ key: 1, text: "ok" }, { key: 1, text: "duplicate" }, { key: 3, text: "" }] } } });
    expect(validation.ok).toBe(false);
    expect(validation.errors.join(" ")).toMatch(/\u0434\u0443\u0431\u043b\u044c/iu);
  });
});
