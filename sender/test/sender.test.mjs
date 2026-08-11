import test from "node:test";
import assert from "node:assert/strict";
import { Backoff } from "../src/backoff.mjs";
import { loadConfig } from "../src/config.mjs";
import { startHealthServer } from "../src/health-server.mjs";
import { HealthState } from "../src/health-state.mjs";
import { ZoomSenderService } from "../src/sender.mjs";
import { WorkerOutboxClient, classifyWorkerFetchError, classifyWorkerHttpStatus } from "../src/worker-client.mjs";
import { DEFAULT_BROWSER_ARGS, buildChatMessageFingerprint, buildZoomWebClientUrl, classifyZoomPresenceText, exactOwnChatRecords, isOwnIdentityChatRecord, sanitizeDiagnosticText, sanitizePageUrl, shouldAttemptChatRecovery } from "../src/adapters/playwright-zoom-sender.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function makeConfig() {
  return {
    workerBaseUrl: "https://worker.example",
    zoomBridgeSecret: "secret",
    outboxLimit: 20,
    minIntervalMs: 1500,
    maxIntervalMs: 30000,
    errorIntervalMs: 10000
  };
}

test("chat recovery runs after admission but is throttled while Zoom is still opening the panel", () => {
  assert.equal(shouldAttemptChatRecovery({ chatOpen: false, zoomJoined: true, waitingRoom: false, lastAttemptAt: 0, now: 20000 }), true);
  assert.equal(shouldAttemptChatRecovery({ chatOpen: false, zoomJoined: true, waitingRoom: false, lastAttemptAt: 15000, now: 20000 }), false);
  assert.equal(shouldAttemptChatRecovery({ chatOpen: false, zoomJoined: false, waitingRoom: true, lastAttemptAt: 0, now: 20000 }), false);
  assert.equal(shouldAttemptChatRecovery({ chatOpen: true, zoomJoined: true, waitingRoom: false, lastAttemptAt: 0, now: 20000 }), false);
});

test("outbox client pulls zoom-only messages and sends ackIds", async () => {
  const calls = [];
  const client = new WorkerOutboxClient(makeConfig(), async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), secret: init.headers["x-nafanya-zoom-secret"] });
    return jsonResponse({ ok: true, messages: [{ id: 1, text: "hello" }] });
  });

  const pulled = await client.pull();
  assert.equal(pulled.messages[0].text, "hello");
  await client.ack([1, "bad", 2]);
  assert.equal(calls[0].url, "https://worker.example/zoom-only/outbox");
  assert.equal(calls[0].secret, "secret");
  assert.deepEqual(calls[1].body.ackIds, [1, 2]);
});

test("worker errors are classified for health without exposing secrets", async () => {
  assert.equal(classifyWorkerHttpStatus(401), "auth");
  assert.equal(classifyWorkerHttpStatus(403), "auth");
  assert.equal(classifyWorkerHttpStatus(408), "timeout");
  assert.equal(classifyWorkerHttpStatus(500), "server");
  assert.equal(classifyWorkerFetchError(new Error("fetch failed: ENOTFOUND")), "network");
  assert.equal(classifyWorkerFetchError(Object.assign(new Error("The operation timed out"), { name: "AbortError" })), "timeout");

  const authClient = new WorkerOutboxClient(makeConfig(), async () => jsonResponse({ ok: false, error: "nope" }, 403));
  await assert.rejects(() => authClient.pull(), (error) => {
    assert.equal(error.workerReason, "auth");
    assert.equal(error.httpStatus, 403);
    assert.doesNotMatch(error.message, /secret/u);
    return true;
  });

  const networkClient = new WorkerOutboxClient(makeConfig(), async () => {
    throw new Error("fetch failed: ECONNRESET");
  });
  await assert.rejects(() => networkClient.pull(), (error) => {
    assert.equal(error.workerReason, "network");
    assert.doesNotMatch(error.message, /secret/u);
    return true;
  });
});

test("config reads dry-run and polling intervals from env with safe fallbacks", () => {
  const config = loadConfig({
    WORKER_BASE_URL: "https://worker.example/",
    ZOOM_ONLY_SECRET: "safe-secret",
    ZOOM_MEETING_URL: "https://zoom.example/meeting",
    ZOOM_DISPLAY_NAME: "Display Name",
    ZOOM_SENDER_DRY_RUN: "true",
    ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS: "true",
    ZOOM_SENDER_MIN_POLL_MS: "2000",
    ZOOM_SENDER_MAX_POLL_MS: "25000",
    ZOOM_SENDER_ERROR_POLL_MS: "7000",
    ZOOM_SENDER_HEALTH_PORT: "4001",
    ZOOM_SENDER_DIAGNOSTICS_DIR: "/tmp/zoom-diagnostics",
    ZOOM_SENDER_BROWSER_ARGS: "--one --two",
    ZOOM_SENDER_OUTBOX_MEETING_ID: "81047381947",
    HEADLESS: "false"
  });
  assert.equal(config.workerBaseUrl, "https://worker.example");
  assert.equal(config.zoomBridgeSecret, "safe-secret");
  assert.equal(config.participantName, "Display Name");
  assert.equal(config.dryRun, true);
  assert.equal(config.chatReadonlyDiagnostics, true);
  assert.equal(config.minIntervalMs, 2000);
  assert.equal(config.maxIntervalMs, 25000);
  assert.equal(config.errorIntervalMs, 7000);
  assert.equal(config.healthPort, 4001);
  assert.equal(config.diagnosticsDir, "/tmp/zoom-diagnostics");
  assert.deepEqual(config.browserArgs, ["--one", "--two"]);
  assert.equal(config.headless, false);
  assert.equal(config.outboxMeetingId, "81047381947");

  const fallback = loadConfig({
    ZOOM_SENDER_MIN_POLL_MS: "bad",
    ZOOM_SENDER_MAX_POLL_MS: "-10",
    ZOOM_SENDER_ERROR_POLL_MS: "also-bad"
  });
  assert.equal(fallback.minIntervalMs, 1500);
  assert.equal(fallback.maxIntervalMs, 1500);
  assert.equal(fallback.errorIntervalMs, 10000);
  assert.equal(fallback.chatReadonlyDiagnostics, false);
  assert.equal(fallback.outboxMeetingId, "");
});

test("replacement safety matches only exact messages owned by Nafanya", () => {
  const records = [
    { recordKind: "zoom-message-identity", sourceMessageId: "9-{c1c14f7f-14ab-4154-b8de-6bddb7ab8f81}", displayName: "You", rawDom: '<div class="new-chat-message__text-box--self"></div>', text: "\u041e\u0427\u0415\u0420\u0415\u0414\u042c \u041e\u0422\u041a\u0420\u042b\u0422\u0410:\n\n1. \u0412\u0430\u0441\u044f" },
    { recordKind: "zoom-message-identity", sourceMessageId: "7-{9f60eaa0-5d15-4b3b-a2da-00a57ca61ac4}", displayName: "\u0410\u043d\u043d\u0430", rawDom: '<div class="new-chat-message__text-box"></div>', text: "\u041e\u0427\u0415\u0420\u0415\u0414\u042c \u041e\u0422\u041a\u0420\u042b\u0422\u0410:\n\n1. \u0412\u0430\u0441\u044f" },
    { recordKind: "zoom-message-group", sourceMessageId: "8-{f394eaff-300a-40c9-9140-2295d49d9fb9}", displayName: "You", rawDom: '<div class="new-chat-message__text-box--self"></div>', text: "\u041e\u0427\u0415\u0420\u0415\u0414\u042c \u041e\u0422\u041a\u0420\u042b\u0422\u0410:\n\n1. \u0412\u0430\u0441\u044f" },
    { recordKind: "zoom-message-identity", sourceMessageId: "10-{f96b0fd8-e0a6-4ec7-b86b-4d67aeff9f3f}", ariaLabel: "\u0412\u044b \u041a\u043e\u043c\u0443 \u0412\u0441\u0435, \u0441\u0435\u0439\u0447\u0430\u0441", text: "\u041e\u0427\u0415\u0420\u0415\u0414\u042c \u041e\u0422\u041a\u0420\u042b\u0422\u0410:\n\n1. \u0412\u0430\u0441\u044f\n2. \u041c\u0430\u0448\u0430" }
  ];
  assert.equal(isOwnIdentityChatRecord(records[0]), true);
  assert.equal(isOwnIdentityChatRecord(records[1]), false);
  assert.equal(isOwnIdentityChatRecord(records[2]), false);
  assert.equal(isOwnIdentityChatRecord(records[3]), true);
  assert.deepEqual(exactOwnChatRecords(records, records[0].text), [records[0]]);
});

test("diagnostics sanitize Zoom URLs before saving", () => {
  assert.equal(
    sanitizePageUrl("https://us06web.zoom.us/j/123456789?pwd=secret&zak=token#join"),
    "https://us06web.zoom.us/j/123456789"
  );
  assert.equal(sanitizePageUrl("not-a-url?pwd=secret"), "not-a-url");
  assert.equal(
    sanitizeDiagnosticText("go https://zoom.us/j/123?pwd=secret&zak=token and x-nafanya-zoom-secret abc"),
    "go https://zoom.us/j/123 and x-nafanya-zoom-secret [redacted]"
  );
  assert.equal(
    buildZoomWebClientUrl("https://us06web.zoom.us/j/123456789?pwd=secret"),
    "https://us06web.zoom.us/wc/join/123456789?pwd=secret"
  );
});

test("sender acks only messages successfully sent to Zoom", async () => {
  const acked = [];
  const workerClient = {
    async pull() {
      return { messages: [{ id: 1, text: "one" }, { id: 2, text: "two" }] };
    },
    async ack(ids) {
      acked.push(...ids);
      return { ok: true };
    }
  };
  const zoomAdapter = {
    async start() { return { zoomPageOpen: true, zoomJoined: true, chatOpen: true }; },
    async getPresence() { return { zoomPageOpen: true, zoomJoined: true, chatOpen: true }; },
    async sendMessage(text) {
      if (text === "two") throw new Error("send failed");
      return { sent: true, ack: true };
    }
  };
  const service = new ZoomSenderService({
    workerClient,
    zoomAdapter,
    backoff: new Backoff(makeConfig()),
    health: new HealthState(),
    logger: { info() {}, warn() {} }
  });

  const result = await service.runOnce();
  assert.deepEqual(acked, []);
  assert.equal(result.ackIds.length, 0);
  assert.match(result.error.message, /send failed/u);
});

test("sender does not ack failed individual sends that return no ack", async () => {
  const acked = [];
  const workerClient = {
    async pull() {
      return { messages: [{ id: 1, text: "one" }, { id: 2, text: "two" }] };
    },
    async ack(ids) {
      acked.push(...ids);
      return { ok: true };
    }
  };
  const zoomAdapter = {
    async getPresence() { return { zoomPageOpen: true, zoomJoined: true, chatOpen: true }; },
    async sendMessage(text) {
      return text === "one" ? { sent: true, ack: true } : { sent: false, ack: false };
    }
  };
  const service = new ZoomSenderService({
    workerClient,
    zoomAdapter,
    backoff: new Backoff(makeConfig()),
    health: new HealthState(),
    logger: { info() {}, warn() {} }
  });

  const result = await service.runOnce();
  assert.deepEqual(acked, [1]);
  assert.deepEqual(result.ackIds, [1]);
});

test("interactive default keeps polling at 1.5 seconds even when outbox is empty", async () => {
  const config = loadConfig({});
  const backoff = new Backoff(config);
  const service = new ZoomSenderService({
    workerClient: { async pull() { return { messages: [] }; } },
    zoomAdapter: { async getPresence() { return { zoomPageOpen: true, zoomJoined: true, chatOpen: true }; } },
    backoff,
    health: new HealthState(),
    logger: { info() {}, warn() {} }
  });

  assert.equal((await service.runOnce()).delayMs, 1500);
  assert.equal((await service.runOnce()).delayMs, 1500);
  assert.equal((await service.runOnce()).delayMs, 1500);
  assert.equal(backoff.onError(), 10000);
});

test("messages reset backoff to minimum and errors use the configured retry delay", async () => {
  const backoff = new Backoff(makeConfig());
  backoff.onMessages(0);
  backoff.onMessages(0);
  assert.equal(backoff.currentDelayMs, 6000);
  assert.equal(backoff.onMessages(1), 1500);
  assert.equal(backoff.onError(), 10000);
  assert.equal(backoff.onError(), 10000);
});

test("sender-only code uses only the outbox and has no retired Zoom chat ingest", async () => {
  const senderSources = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/sender.mjs", import.meta.url), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/worker-client.mjs", import.meta.url), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/adapters/playwright-zoom-sender.mjs", import.meta.url), "utf8"))
  ]);
  const source = senderSources.join("\n");
  assert.doesNotMatch(source, /queue-engine|parseQueueEntry|parseZoomCommand/u);
  assert.doesNotMatch(source, /chatIngestEnabled|ingestChatMessage|\/zoom-only\/chat-ingest|\/zoom-only\/webhook|sendIncomingMessage|selectZoomChatCodeIngestCandidates/u);
  assert.match(source, /\/zoom-only\/outbox/u);
});

test("Zoom browser adapter handles the Zoom web landing gate and read-only diagnostics stays isolated", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/adapters/playwright-zoom-sender.mjs", import.meta.url), "utf8");
  assert.match(source, /join from browser/iu);
  assert.match(source, /decline cookies|accept cookies/iu);
  assert.match(source, /continue without microphone and camera/iu);
  assert.match(source, /getByText\(pattern\)/u);
  assert.match(source, /button, a, \[role='button'\]/u);
  assert.match(source, /input\[type="text"\]:visible/u);
  assert.match(source, /\[role="textbox"\]\[aria-placeholder\*="chat" i\]/u);
  assert.match(source, /open\\s\+the\\s\+chat\\s\+panel/u);
  assert.match(source, /MORE_BUTTON_PATTERNS/u);
  assert.match(source, /chatUnavailable/u);
  assert.match(source, /after-fill-name/u);
  assert.match(source, /nameFilled/u);
  assert.match(source, /page\.on\("console"/u);
  assert.match(source, /page\.on\("requestfailed"/u);
  assert.match(source, /chat-readonly-diagnostics\.jsonl/u);
  assert.match(source, /ZOOM_MESSAGE_REF_RE/u);
  assert.match(source, /document\.querySelectorAll\("\[data-id\], \[id\]"\)/u);
  assert.match(source, /img\[data-emoji\]/u);
  assert.doesNotMatch(source, /new-chat-message__options button|ancestor-or-self::\*\[@role='row'\]|menuitemradio/u);
  assert.match(source, /recordKind:\s*"zoom-message-identity"/u);
  assert.match(source, /sourceMessageId/u);
  assert.match(source, /itemDataId/u);
  assert.match(source, /messageBoxId/u);
  assert.match(source, /datetime/u);
  assert.doesNotMatch(source, /\/zoom-only\/webhook|parseQueueEntry|parseZoomCommand/u);
});

test("read-only chat diagnostics observes without sending or calling webhook", async () => {
  let observed = 0;
  let sent = 0;
  const workerUrls = [];
  const service = new ZoomSenderService({
    workerClient: {
      async pull() {
        workerUrls.push("/zoom-only/outbox");
        return { messages: [] };
      }
    },
    zoomAdapter: {
      async getPresence() { return { zoomPageOpen: true, zoomJoined: true, chatOpen: true }; },
      async observeChatDiagnostics() {
        observed += 1;
        return { enabled: true, newMessages: 1 };
      },
      async sendMessage() {
        sent += 1;
        return { sent: true, ack: true };
      }
    },
    backoff: new Backoff(makeConfig()),
    health: new HealthState(),
    logger: { info() {}, warn() {} }
  });

  const result = await service.runOnce();
  assert.equal(observed, 1);
  assert.equal(sent, 0);
  assert.equal(result.messages, 0);
  assert.deepEqual(workerUrls, ["/zoom-only/outbox"]);
  assert.ok(workerUrls.every((url) => url !== "/zoom-only/webhook"));
});

test("chat diagnostics fingerprint is stable and separates duplicates from different authors", () => {
  const first = buildChatMessageFingerprint({ displayName: "Маша", text: "111", timestamp: "10:00", domPath: "div:1" });
  const duplicate = buildChatMessageFingerprint({ displayName: "Маша", text: "111", timestamp: "10:00", domPath: "div:1" });
  const sameTextOtherNode = buildChatMessageFingerprint({ displayName: "Маша", text: "111", timestamp: "10:00", domPath: "div:2" });
  const otherAuthor = buildChatMessageFingerprint({ displayName: "Маня", text: "111", timestamp: "10:00", domPath: "div:1" });
  assert.equal(first, duplicate);
  assert.notEqual(first, sameTextOtherNode);
  assert.notEqual(first, otherAuthor);
  assert.match(first, /^chat-[0-9a-f]{8}$/u);
});

test("real-mode browser launch uses safe Zoom Web Client flags", () => {
  assert.ok(DEFAULT_BROWSER_ARGS.includes("--no-sandbox"));
  assert.ok(DEFAULT_BROWSER_ARGS.includes("--disable-dev-shm-usage"));
  assert.ok(DEFAULT_BROWSER_ARGS.includes("--use-fake-ui-for-media-stream"));
  assert.ok(DEFAULT_BROWSER_ARGS.includes("--use-fake-device-for-media-stream"));
  assert.ok(DEFAULT_BROWSER_ARGS.includes("--disable-blink-features=AutomationControlled"));
});

test("sender explicitly turns microphone and video off after joining", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/adapters/playwright-zoom-sender.mjs", import.meta.url), "utf8");
  assert.match(source, /mute my microphone/iu);
  assert.match(source, /stop my video/iu);
  assert.match(source, /await ensureMeetingMediaOff\(this\.page\)/u);
});

test("pre-meeting host wait is not reported as joined merely because microphone controls exist", () => {
  const waiting = classifyZoomPresenceText("\u0414\u043e\u0436\u0434\u0438\u0442\u0435\u0441\u044c, \u043a\u043e\u0433\u0434\u0430 \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0442\u043e\u0440 \u043d\u0430\u0447\u043d\u0435\u0442 \u043a\u043e\u043d\u0444\u0435\u0440\u0435\u043d\u0446\u0438\u044e. \u041c\u0438\u043a\u0440\u043e\u0444\u043e\u043d");
  assert.deepEqual(waiting, { waitingRoom: true, zoomJoined: false });
  const joined = classifyZoomPresenceText("\u0423\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u0438 3 \u0427\u0430\u0442 \u0412\u044b\u0439\u0442\u0438");
  assert.deepEqual(joined, { waitingRoom: false, zoomJoined: true });
});

test("docker packaging is sender-only and contains no obvious secrets", async () => {
  const fs = await import("node:fs/promises");
  const [dockerfile, compose, envExample, runbook] = await Promise.all([
    fs.readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    fs.readFile(new URL("../compose.example.yml", import.meta.url), "utf8"),
    fs.readFile(new URL("../.env.example", import.meta.url), "utf8"),
    fs.readFile(new URL("../RUNBOOK.md", import.meta.url), "utf8")
  ]);
  assert.match(dockerfile, /node src\/main\.mjs/u);
  assert.match(dockerfile, /ZOOM_AUTH_SETUP/u);
  assert.match(dockerfile, /node src\/auth-setup\.mjs/u);
  assert.match(dockerfile, /playwright install --with-deps chromium/u);
  assert.match(dockerfile, /xvfb xauth x11-utils/u);
  assert.match(dockerfile, /Xvfb :99/u);
  assert.match(compose, /service|zoom-sender/u);
  assert.match(compose, /healthcheck:/u);
  assert.match(compose, /zoom-sender-profile:\/app\/profile/u);
  assert.match(compose, /\.\/diagnostics:\/app\/diagnostics/u);
  assert.match(compose, /stop_grace_period:\s*30s/u);
  assert.match(envExample, /ZOOM_ONLY_SECRET=/u);
  assert.match(envExample, /ZOOM_AUTH_SETUP=false/u);
  assert.match(envExample, /ZOOM_AUTH_EMAIL=\s*(?:\r?\n)/u);
  assert.match(envExample, /ZOOM_AUTH_PASSWORD=\s*(?:\r?\n)/u);
  assert.match(envExample, /ZOOM_AUTH_WAIT_FOR_MANUAL=false/u);
  assert.doesNotMatch(envExample, /replace-with-worker-secret|super-secret|sk-[a-z0-9]/iu);
  assert.match(runbook, /старый `zoom-bridge` удалён/iu);
  assert.match(runbook, /не вызывает старые webhook\/ingest-маршруты/iu);
});

test("auth setup uses server env credentials without hardcoded secrets or artifacts", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/auth-setup.mjs", import.meta.url), "utf8");
  assert.match(source, /ZOOM_AUTH_EMAIL/u);
  assert.match(source, /ZOOM_AUTH_PASSWORD/u);
  assert.match(source, /ZOOM_AUTH_WAIT_FOR_MANUAL/u);
  assert.match(source, /waiting for manual verification/u);
  assert.match(source, /https:\/\/app\.zoom\.us\/profile/u);
  assert.match(source, /confirmPersistentSignIn/u);
  assert.doesNotMatch(source, /join\|enter meeting info\|your name/u);
  assert.match(source, /Zoom auth profile setup completed/u);
  assert.match(source, /hasFirstVisible/u);
  assert.match(source, /launchPersistentContext/u);
  assert.match(source, /manual_verification_required/u);
  assert.doesNotMatch(source, /screenshot|storageState|cookies\(\)|console\.log\([^)]*email|console\.log\([^)]*password/iu);
});

test("health reports warning/unhealthy unless Zoom page and chat are ready", () => {
  const health = new HealthState();
  health.markWorkerPoll();
  health.updateBackoff({ currentDelayMs: 1500 });
  let snapshot = health.snapshot();
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.status, "unhealthy");

  health.updateZoom({ zoomPageOpen: true, zoomJoined: false, chatOpen: false, waitingRoom: true });
  snapshot = health.snapshot();
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.status, "warning");
  assert.equal(snapshot.waitingRoom, true);

  health.updateZoom({ zoomPageOpen: true, zoomJoined: true, chatOpen: false });
  snapshot = health.snapshot();
  assert.equal(snapshot.status, "warning");

  health.updateZoom({ zoomPageOpen: true, zoomJoined: true, chatOpen: true });
  health.markSend();
  health.clearError();
  snapshot = health.snapshot();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.status, "healthy");
  assert.ok(snapshot.lastSuccessfulSendAt);

  health.markError(new Error("boom"));
  snapshot = health.snapshot();
  assert.match(snapshot.lastError.message, /boom/u);
});

test("health endpoint answers and dry-run does not pretend real Zoom is ready", async () => {
  const health = new HealthState({ dryRun: true });
  health.markWorkerPoll();
  health.updateBackoff({ currentDelayMs: 30000 });
  const server = startHealthServer(
    { healthHost: "127.0.0.1", healthPort: 0 },
    health,
    { info() {} }
  );
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  const body = await response.json();
  await new Promise((resolve) => server.close(resolve));

  assert.equal(response.status, 503);
  assert.equal(body.dryRun, true);
  assert.equal(body.workerAvailable, true);
  assert.equal(body.zoomPageOpen, false);
  assert.equal(body.status, "unhealthy");
});

test("health lastError redacts secret-looking values", () => {
  const previousSecret = process.env.ZOOM_ONLY_SECRET;
  process.env.ZOOM_ONLY_SECRET = "super-secret-token";
  try {
    const health = new HealthState();
    health.markError(new Error("Worker rejected secret=super-secret-token and x-nafanya-zoom-secret super-secret-token"));
    const snapshot = health.snapshot();
    assert.doesNotMatch(snapshot.lastError.message, /super-secret-token/u);
    assert.match(snapshot.lastError.message, /\[redacted\]/u);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.ZOOM_ONLY_SECRET;
    } else {
      process.env.ZOOM_ONLY_SECRET = previousSecret;
    }
  }
});
