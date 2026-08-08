import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const panelHeaders = { "content-type": "application/json", "x-nafanya-zoom-panel-token": "panel-test-secret" };
const senderHeaders = { "content-type": "application/json", "x-nafanya-zoom-secret": "sender-test-secret" };

async function action(body) {
  const response = await SELF.fetch("https://worker.test/zoom-only/app/action", { method: "POST", headers: panelHeaders, body: JSON.stringify(body) });
  return { response, data: await response.json() };
}

describe("Zoom-only Worker", () => {
  it("serves health without exposing secrets", async () => {
    const response = await SELF.fetch("https://worker.test/health");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Nafanya Zoom Bridge");
    expect(text).not.toContain("panel-test-secret");
  });

  it("protects panel and outbox independently", async () => {
    expect((await SELF.fetch("https://worker.test/zoom-only/app")).status).toBe(401);
    expect((await SELF.fetch("https://worker.test/zoom-only/app?token=panel-test-secret")).status).toBe(401);
    expect((await SELF.fetch("https://worker.test/zoom-only/outbox", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await SELF.fetch("https://worker.test/zoom-only/app", { headers: panelHeaders })).status).toBe(200);
  });

  it("clears the server-active day and never subscribes to participant joins", async () => {
    const response = await SELF.fetch("https://worker.test/zoom-only/app", { headers: panelHeaders });
    const panel = await response.text();
    expect(panel).toContain("activeBoardDay=data.meetingBoard?.dayKey||activeBoardDay");
    expect(panel).toContain('document.querySelector(\'[data-day="\'+activeBoardDay+\'"]\')');
    expect(panel).not.toContain("onParticipantChange");
    expect(panel).not.toContain("meeting_board_replay");
  });

  it("allows identical queue text but ignores a repeated requestId", async () => {
    const first = await action({ action: "meeting_board_add_entry", dayKey: "monday", text: "Alex 111", requestId: "same-request" });
    const duplicateClick = await action({ action: "meeting_board_add_entry", dayKey: "monday", text: "Alex 111", requestId: "same-request" });
    const secondVisit = await action({ action: "meeting_board_add_entry", dayKey: "monday", text: "Alex 111", requestId: "new-request" });
    expect(first.data.ok).toBe(true);
    expect(duplicateClick.data.duplicate).toBe(true);
    expect(secondVisit.data.state.entries.filter((item) => item.text === "Alex 111")).toHaveLength(2);
  });

  it("marks, restores, defers and removes entries while preserving order", async () => {
    const added = await action({ action: "meeting_board_add_entry", dayKey: "tuesday", text: "First", requestId: crypto.randomUUID() });
    const firstId = added.data.state.entries.at(-1).id;
    const second = await action({ action: "meeting_board_add_entry", dayKey: "tuesday", text: "Second", requestId: crypto.randomUUID() });
    await action({ action: "meeting_board_mark_spoken", dayKey: "tuesday", id: firstId, requestId: crypto.randomUUID() });
    const restored = await action({ action: "meeting_board_restore_waiting", dayKey: "tuesday", id: firstId, requestId: crypto.randomUUID() });
    expect(restored.data.state.entries.find((item) => item.id === firstId).status).toBe("waiting");
    const deferred = await action({ action: "meeting_board_defer_entry", dayKey: "tuesday", id: firstId, requestId: crypto.randomUUID() });
    expect(deferred.data.state.entries.findIndex((item) => item.id === firstId)).toBeGreaterThan(restored.data.state.entries.findIndex((item) => item.id === firstId));
    const secondId = second.data.state.entries.at(-1).id;
    const removed = await action({ action: "meeting_board_remove_entry", dayKey: "tuesday", id: secondId, requestId: crypto.randomUUID() });
    expect(removed.data.state.entries.some((item) => item.id === secondId)).toBe(false);
  });

  it("keeps speaker questions separate from the ordinary queue", async () => {
    await action({ action: "speaker_questions_add", text: "Question to speaker", requestId: crypto.randomUUID() });
    const statusResponse = await SELF.fetch("https://worker.test/zoom-only/status", { headers: panelHeaders });
    const status = await statusResponse.json();
    expect(status.speakerQuestions.entries.some((item) => item.text === "Question to speaker")).toBe(true);
    expect(status.meetingBoard.entries.some((item) => item.text === "Question to speaker")).toBe(false);
  });

  it("keeps the Team Chat laboratory in a meeting-specific object", async () => {
    const headers = { ...panelHeaders, "x-nafanya-zoom-meeting-id": "TEST-999" };
    const response = await SELF.fetch("https://worker.test/zoom-only/app/action", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "meeting_board_add_entry", dayKey: "friday", text: "Test-only entry", requestId: crypto.randomUUID() })
    });
    const result = await response.json();
    expect(result.ok).toBe(true);
    expect(result.teamChat.status).toBe("sdk_required");
    expect(result.queued).toHaveLength(0);
    const testStatus = await (await SELF.fetch("https://worker.test/zoom-only/status", { headers })).json();
    const productionStatus = await (await SELF.fetch("https://worker.test/zoom-only/status", { headers: panelHeaders })).json();
    expect(testStatus.meetingBoard.entries.some((item) => item.text === "Test-only entry")).toBe(true);
    expect(productionStatus.meetingBoard.entries.some((item) => item.text === "Test-only entry")).toBe(false);
  });

  it("clears the ordinary queue and topics without touching speaker questions", async () => {
    await action({ action: "meeting_board_add_entry", dayKey: "thursday", text: "Queue entry", requestId: crypto.randomUUID() });
    await action({ action: "meeting_board_add_topic", dayKey: "thursday", text: "Extra topic", requestId: crypto.randomUUID() });
    await action({ action: "speaker_questions_add", text: "Speaker question", requestId: crypto.randomUUID() });
    const requestId = crypto.randomUUID();
    const cleared = await action({ action: "meeting_board_clear_current", dayKey: "thursday", requestId });
    const duplicate = await action({ action: "meeting_board_clear_current", dayKey: "thursday", requestId });
    expect(cleared.data.state.entries).toHaveLength(0);
    expect(cleared.data.state.additionalTopics).toHaveLength(0);
    expect(duplicate.data.duplicate).toBe(true);
    const status = await (await SELF.fetch("https://worker.test/zoom-only/status", { headers: panelHeaders })).json();
    expect(status.speakerQuestions.entries.some((item) => item.text === "Speaker question")).toBe(true);
  });

  it("delivers and acknowledges outbox messages", async () => {
    await action({ type: "message", key: "welcome" });
    const pull = await SELF.fetch("https://worker.test/zoom-only/outbox", { method: "POST", headers: senderHeaders, body: JSON.stringify({ limit: 20 }) });
    const pulled = await pull.json();
    expect(pulled.messages.length).toBeGreaterThan(0);
    expect(pulled.messages.every((item) => Array.from(item.text).length <= 950)).toBe(true);
    const ids = pulled.messages.map((item) => item.id);
    const ack = await SELF.fetch("https://worker.test/zoom-only/outbox", { method: "POST", headers: senderHeaders, body: JSON.stringify({ ackIds: ids, limit: 20 }) });
    expect((await ack.json()).messages.some((item) => ids.includes(item.id))).toBe(false);
  });

  it("leases the native indicator only to a supported desktop client", async () => {
    const started = await action({ action: "zoom_timer_action", timerAction: "start", baseMs: 60_000, remainingMs: 1, product: "mobile", instanceId: "mobile-1", requestId: crypto.randomUUID() });
    expect(started.data.state.status).toBe("running");
    expect(started.data.executorActive).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const sync = await action({ action: "zoom_timer_action", timerAction: "sync", product: "desktop", indicatorSupported: true, instanceId: "desktop-1" });
    expect(sync.data.state.status).toBe("finished");
    expect(sync.data.executorActive).toBe(true);
    expect(sync.data.isExecutor).toBe(true);
  });
});
