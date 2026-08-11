import test from "node:test";
import assert from "node:assert/strict";
import { ZoomControlService, publicHealth, safeError } from "../control-agent/service.mjs";
import { SAFE_VALUES, updateEnvText } from "../control-agent/docker-ops.mjs";
import { buildControlHtml } from "../control-agent/html.mjs";
import { createCipheriv, createHash } from "node:crypto";
import { buildZoomAppSessionCookie, decryptZoomAppContext, issueZoomAppSession, verifyZoomAppSession } from "../control-agent/zoom-app-auth.mjs";

function encryptZoomAppContext(context, secret) {
  const iv = Buffer.from("000102030405060708090a0b", "hex");
  const aad = Buffer.from("zoom-app", "utf8");
  const key = createHash("sha256").update(secret, "utf8").digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(context), "utf8"), cipher.final()]);
  const header = Buffer.alloc(1 + iv.length + 2 + aad.length + 4);
  let offset = 0;
  header.writeUInt8(iv.length, offset); offset += 1;
  iv.copy(header, offset); offset += iv.length;
  header.writeUInt16LE(aad.length, offset); offset += 2;
  aad.copy(header, offset); offset += aad.length;
  header.writeUInt32LE(ciphertext.length, offset);
  return Buffer.concat([header, ciphertext, cipher.getAuthTag()]).toString("base64url");
}

function fakeOps(overrides = {}) {
  const calls = [];
  const ops = {
    calls,
    async isOldBridgeRunning() { return false; },
    async isSenderRunning() { return false; },
    async profileLocks() { return []; },
    async clearProfileLocks() { calls.push("clear-locks"); },
    async setRuntimeMode(mode) { calls.push(`mode:${mode}`); },
    async startSender() { calls.push("start-sender"); },
    async stopSender() { calls.push("stop-sender"); },
    async getSenderHealth() { return { status: "healthy", zoomJoined: true, chatOpen: true, lastError: null }; },
    async getQueueStatus() { return { queueOpen: false, outboxSize: 0 }; },
    async detectAuthRequired() { return false; },
    async startAuthSetup() { calls.push("auth-setup:start"); return "a".repeat(64); },
    async getAuthSetupState() { return { state: "completed" }; },
    async stopAuthSetup() { calls.push("auth-setup:stop"); },
    async sleep() {},
    ...overrides
  };
  return ops;
}

test("control status reports sender off", async () => {
  const service = new ZoomControlService(fakeOps());
  assert.deepEqual(await service.status(), { running: false, health: null, mode: "off", authSetupState: "auth_setup_idle", authViewAvailable: false, lastError: null });
});

test("control start uses only live mode and sender start", async () => {
  let running = false;
  const ops = fakeOps({
    async isSenderRunning() { return running; },
    async startSender() { ops.calls.push("start-sender"); running = true; }
  });
  const service = new ZoomControlService(ops, { startTimeoutMs: 20, pollMs: 1 });
  assert.equal(service.requestStart().accepted, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(ops.calls, ["mode:live", "start-sender"]);
  assert.equal((await service.status()).mode, "ready");
  assert.ok(!ops.calls.some((call) => /bridge/iu.test(call)));
});

test("control start refuses to run while old bridge is active", async () => {
  const ops = fakeOps({ async isOldBridgeRunning() { return true; } });
  const service = new ZoomControlService(ops, { startTimeoutMs: 10, pollMs: 1 });
  service.requestStart();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const status = await service.status();
  assert.equal(status.mode, "error");
  assert.match(status.lastError, /bridge/iu);
  assert.ok(!ops.calls.includes("start-sender"));
});

test("control stop ignores preserved legacy queue state", async () => {
  const ops = fakeOps({ async getQueueStatus() { return { queueOpen: true }; } });
  const service = new ZoomControlService(ops);
  const result = await service.stop();
  assert.equal(result.ok, true);
  assert.deepEqual(ops.calls, ["stop-sender", "mode:safe"]);
});

test("control stop uses only sender stop and safe mode", async () => {
  const ops = fakeOps();
  const service = new ZoomControlService(ops);
  const result = await service.stop();
  assert.equal(result.ok, true);
  assert.deepEqual(ops.calls, ["stop-sender", "mode:safe"]);
});

test("auth-required and safe public errors do not expose secrets", async () => {
  const ops = fakeOps({ async isSenderRunning() { return true; }, async detectAuthRequired() { return true; }, async getSenderHealth() { return { status: "warning", zoomJoined: false, chatOpen: false }; } });
  const service = new ZoomControlService(ops);
  assert.equal((await service.status()).mode, "auth_required");
  const error = safeError("token=abcd password=hunter2");
  assert.doesNotMatch(error, /abcd|hunter2/u);
  assert.deepEqual(publicHealth({ status: "unhealthy", lastError: { message: "secret=hidden" } }).lastError, "secret=[redacted]");
});

test("public health exposes readiness reasons without secrets", () => {
  const health = publicHealth({
    status: "unhealthy",
    workerAvailable: false,
    zoomJoined: true,
    chatOpen: false,
    chatUnavailable: true,
    chatReason: "unavailable",
    lastWorkerError: {
      reason: "auth",
      httpStatus: 403,
      message: "secret=hidden token=abcd"
    }
  });
  assert.equal(health.workerAvailable, false);
  assert.equal(health.chatUnavailable, true);
  assert.equal(health.chatReason, "unavailable");
  assert.equal(health.lastWorkerError.reason, "auth");
  assert.equal(health.lastWorkerError.httpStatus, 403);
  assert.doesNotMatch(health.lastWorkerError.message, /hidden|abcd/u);
});

test("an admitted sender with a closed chat is an error, not endless starting", async () => {
  const ops = fakeOps({
    async isSenderRunning() { return true; },
    async getSenderHealth() {
      return { status: "warning", workerAvailable: true, zoomJoined: true, waitingRoom: false, chatOpen: false, chatUnavailable: false };
    }
  });
  const service = new ZoomControlService(ops);
  const status = await service.status();
  assert.equal(status.mode, "error");
  assert.match(status.lastError, /\u0447\u0430\u0442 \u043d\u0435 \u043e\u0442\u043a\u0440\u044b\u043b\u0441\u044f/iu);
});

test("control start reports worker and chat readiness failures honestly", async () => {
  let workerRunning = false;
  const workerOps = fakeOps({
    async isSenderRunning() { return workerRunning; },
    async startSender() { workerRunning = true; },
    async getSenderHealth() {
      return {
        status: "unhealthy",
        workerAvailable: false,
        zoomJoined: true,
        chatOpen: false,
        lastWorkerError: { reason: "auth", httpStatus: 403, message: "forbidden" }
      };
    },
    async sleep() { await new Promise((resolve) => setTimeout(resolve, 2)); }
  });
  const workerService = new ZoomControlService(workerOps, { startTimeoutMs: 20, pollMs: 1 });
  workerService.requestStart();
  await new Promise((resolve) => setTimeout(resolve, 8));
  assert.match((await workerService.status()).lastError, /Worker недоступен: auth HTTP 403/u);

  let chatRunning = false;
  const chatOps = fakeOps({
    async isSenderRunning() { return chatRunning; },
    async startSender() { chatRunning = true; },
    async getSenderHealth() {
      return {
        status: "warning",
        workerAvailable: true,
        zoomJoined: true,
        chatOpen: false,
        chatUnavailable: true
      };
    },
    async sleep() { await new Promise((resolve) => setTimeout(resolve, 2)); }
  });
  const chatService = new ZoomControlService(chatOps, { startTimeoutMs: 20, pollMs: 1 });
  chatService.requestStart();
  await new Promise((resolve) => setTimeout(resolve, 8));
  assert.equal((await chatService.status()).lastError, "Встреча открыта, но чат недоступен.");
});

test("env mode updates only whitelisted values", () => {
  const result = updateEnvText("ZOOM_SENDER_DRY_RUN=true\nZOOM_MEETING_URL=private\n", { ZOOM_SENDER_DRY_RUN: "false", ZOOM_AUTH_SETUP: "false" });
  assert.match(result, /ZOOM_SENDER_DRY_RUN=false/u);
  assert.match(result, /ZOOM_AUTH_SETUP=false/u);
  assert.match(result, /ZOOM_MEETING_URL=private/u);
});

test("live mode has no legacy Zoom chat-ingest switch", () => {
  assert.equal("ZOOM_SENDER_CHAT_INGEST_ENABLED" in SAFE_VALUES.live, false);
});

test("control page exposes human buttons and statuses without secrets", () => {
  const html = buildControlHtml();
  assert.match(html, /Включить Нафаню/u);
  assert.match(html, /Выключить Нафаню/u);
  assert.match(html, /В Zoom, чат открыт/u);
  assert.match(html, /Нужен вход в Zoom/u);
  assert.match(html, /Открыть окно Zoom для входа/u);
  assert.match(html, /Остановить восстановление входа/u);
  assert.match(html, /Нажмите Обновить или Выключить Нафаню/u);
  assert.match(html, /Нажмите Починить вход Zoom/u);
  assert.match(html, /\.\/vnc\/vnc\.html/u);
  assert.match(html, /\.auth-help\[hidden\]\{display:none\}/u);
  assert.match(html, /<section class="control">[\s\S]*<iframe id="workerPanel"/u);
  assert.match(html, /class="admin-panel"/u);
  assert.match(html, /Админ \/ вход Zoom/u);
  assert.match(html, /function syncAdminVisibility/u);
  assert.match(html, /\$\("auth"\)\.hidden=!needAuth&&!admin\.open/u);
  assert.match(html, /authorizedFetch\("\.\/api\/status"/u);
  assert.match(html, /async function refreshAll\(\)[\s\S]*worker-panel\?refresh=/u);
  assert.match(html, /\$\("stop"\)\.disabled=busy\|\|!s\.running/u);
  assert.match(html, /let pendingMessage=""/u);
  assert.match(html, /pendingMessage=data\.error\|\|"Операция не выполнена"/u);
  assert.match(html, /\[s\.lastError,pendingMessage,next\]/u);
  assert.match(html, /button:active,.auth-link:active\{transform:translateY\(2px\)/u);
  assert.match(html, /box-shadow:0 3px 0 #777267/u);
  assert.match(html, /class="power-row">[\s\S]*id="start"[\s\S]*id="stop"[\s\S]*<\/div>/u);
  assert.match(html, /Обновить состояние/u);
  assert.match(html, /body\{margin:0;min-height:100vh;overflow:auto;background:#f5f6fa\}/u);
  assert.match(html, /\.control\{position:static/u);
  assert.match(html, /new ResizeObserver\(resizeWorkerPanel\)/u);
  assert.doesNotMatch(html, /ZOOM_CONTROL_TOKEN|ZOOM_PANEL_TOKEN|ZOOM_MEETING_URL/u);
});

test("control page has a configurable shared host timer and collapsible tech panel", () => {
  const html = buildControlHtml({ zoomApp: true });
  assert.match(html, /<section class="control">[\s\S]*id="timerPanel"[\s\S]*id="techPanel"/u);
  assert.match(html, /id="timerPanel" open>[\s\S]*Таймер ведущего/u);
  assert.match(html, /id="techPanel" open>[\s\S]*Пульт техведа/u);
  assert.match(html, /id="timerDisplay"[^>]*>5:00</u);
  assert.match(html, /id="timerMinutes"[^>]*value="5"/u);
  assert.match(html, /id="timerStart">Старт</u);
  assert.match(html, /id="timerPause" disabled>Пауза</u);
  assert.match(html, /id="timerPlus1">\+1</u);
  assert.match(html, /id="timerPlus2">\+2</u);
  assert.match(html, /id="timerReset">Стоп \/ сброс</u);
  assert.match(html, /const TIMER_DEFAULT_MS=5\*60\*1000/u);
  assert.match(html, /baseMs:TIMER_DEFAULT_MS/u);
  assert.match(html, /action:"zoom_timer_action"/u);
  assert.match(html, /timerRequest\("sync"\)/u);
  assert.match(html, /setInterval\(syncSharedTimer,5000\)/u);
  assert.doesNotMatch(html, /setInterval\(syncSharedTimer,1500\)/u);
  assert.match(html, /configured\.product/u);
  assert.match(html, /zoomProduct==="desktop"&&timerExecutor&&timerIndicatorSupported/u);
  assert.match(html, /configured\.product/u);
  assert.doesNotMatch(html, /timerPreview|Проверить 7 гудков/u);
  assert.match(html, /withSound:true/u);
  assert.match(html, /function indicatorMilliseconds\(\)\{return Math\.max\(0,Math\.ceil\(remainingNow\(\)\)\)\}/u);
  assert.match(html, /start:indicatorMilliseconds\(\)/u);
  assert.doesNotMatch(html, /indicatorMilliseconds\(\)[\s\S]{0,80}\/1000/u);
  assert.doesNotMatch(html, /songChoice|timerSound/u);
  assert.match(html, /getSupportedJsApis/u);
  assert.match(html, /indicatorSupported:timerIndicatorSupported/u);
  assert.doesNotMatch(html, /for\(let index=0;index<7;index\+\+|shareComputerAudio|onParticipantChange|meeting_board_replay|claim_finish/u);
  assert.match(html, /timerCommand\("extend",\{deltaMs:minutes\*60000\}\)/u);
  assert.doesNotMatch(html, /extendDuration:minutes\*60000/u);
  assert.doesNotMatch(html, /AudioContext|webkitAudioContext/u);
  assert.doesNotMatch(html, /timer-note|id="timerNote"|Цифры видят|семь гудков слышат/u);
  assert.match(html, /document\.activeElement!==minutesInput/u);
});

test("Zoom App page initializes the SDK and hides server administration", () => {
  const html = buildControlHtml({ zoomApp: true });
  assert.match(html, /https:\/\/appssdk\.zoom\.us\/sdk\.js/u);
  assert.match(html, /zoomSdk\.config/u);
  assert.match(html, /appPopout/u);
  assert.match(html, /setDynamicIndicator/u);
  assert.match(html, /removeDynamicIndicator/u);
  assert.match(html, /extendDynamicIndicator/u);
  assert.doesNotMatch(html, /setVirtualForeground|removeVirtualForeground|timerOnTile/u);
  assert.match(html, /id="popout"/u);
  assert.match(html, /class="utility-row"><button id="popout"/u);
  assert.match(html, /Сделать отдельным окном/u);
  assert.doesNotMatch(html, /showAppInvitationDialog|id="invite"|Пригласить помощника/u);
  assert.match(html, /id="adminPanel" hidden>[\s\S]*id="refresh"/u);
  assert.doesNotMatch(buildControlHtml(), /appssdk\.zoom\.us/u);
  assert.match(html, /function reauthorizeZoomApp\(response\)/u);
  assert.match(html, /response\.status!==401/u);
  assert.match(html, /location\.replace\(url\.toString\(\)\)/u);
  assert.match(html, /async function authorizedFetch\(resource,options\)/u);
});

test("native timer treats an already absent indicator as a successful reset", () => {
  const html = buildControlHtml({ zoomApp: true });
  assert.match(html, /dynamicIndicatorAlreadyAbsent/u);
  assert.match(html, /no dynamic indicator to remove/iu);
  assert.match(html, /if\(dynamicIndicatorAlreadyAbsent\(error\)\)return true/u);
});

test("Zoom App context issues a meeting-length session after validation", () => {
  const nowMs = Date.UTC(2026, 6, 30, 20, 0, 0);
  const secret = "test-client-secret";
  const context = { typ: "meeting", mid: "meeting-uuid", uid: "user-id", exp: Math.floor(nowMs / 1000) + 3600 };
  const encrypted = encryptZoomAppContext(context, secret);
  assert.deepEqual(decryptZoomAppContext(encrypted, secret, { nowMs }), context);

  const session = issueZoomAppSession(context, secret, { nowMs });
  assert.equal(verifyZoomAppSession(session, secret, { nowMs })?.mid, "meeting-uuid");
  assert.equal(verifyZoomAppSession(`${session}x`, secret, { nowMs }), null);
  assert.equal(verifyZoomAppSession(session, secret, { nowMs: nowMs + 3_700_000 })?.mid, "meeting-uuid");
  assert.equal(verifyZoomAppSession(session, secret, { nowMs: nowMs + 12 * 60 * 60 * 1000 + 1 }), null);
  assert.match(buildZoomAppSessionCookie("nafanya_zoom_app", session), /HttpOnly; Secure; SameSite=None/u);

  assert.throws(() => decryptZoomAppContext(encryptZoomAppContext({ ...context, exp: Math.floor(nowMs / 1000) - 1 }, secret), secret, { nowMs }), /expired/u);
  assert.throws(() => decryptZoomAppContext(encryptZoomAppContext({ ...context, mid: "" }, secret), secret, { nowMs }), /meeting_required/u);
  assert.throws(() => decryptZoomAppContext(encrypted.slice(0, -2) + "aa", secret, { nowMs }), /invalid/u);
});

test("healthy refresh clears a stale timeout error", async () => {
  const ops = fakeOps({ async isSenderRunning() { return true; } });
  const service = new ZoomControlService(ops);
  service.lastMode = "error";
  service.lastError = "Нафаня не успел войти в Zoom и открыть чат.";
  const status = await service.status();
  assert.equal(status.mode, "ready");
  assert.equal(status.lastError, null);
});

test("stopped sender does not keep a stale error", async () => {
  const service = new ZoomControlService(fakeOps());
  service.lastMode = "error";
  service.lastError = "Нафаня не успел войти в Zoom и открыть чат.";
  const status = await service.status();
  assert.equal(status.mode, "off");
  assert.equal(status.lastError, null);
});

test("control HTTP entrypoint uses protected cookie and fixed routes", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../control-agent/main.mjs", import.meta.url), "utf8");
  assert.match(source, /timingSafeEqual/u);
  assert.match(source, /HttpOnly; Secure; SameSite=Strict/u);
  assert.match(source, /\/api\/start/u);
  assert.match(source, /\/api\/stop/u);
  assert.match(source, /\/api\/auth-setup/u);
  assert.match(source, /\/auth\/check/u);
  assert.match(source, /x-zoom-app-context/u);
  assert.match(source, /\/zoom-app/u);
  assert.match(source, /decryptZoomAppContext/u);
  assert.doesNotMatch(source, /team_chat_test|ZOOM_TEAM_CHAT|workerMeetingId/u);
  assert.match(source, /zoomAppLockedHtml/u);
  assert.match(source, /strict-transport-security/u);
  assert.match(source, /url\.pathname === "\/zoom-only\/library\/import" && access !== "admin"/u);
  assert.match(source, /\/api\/auth-setup\/stop/u);
  assert.ok(source.includes(`.replaceAll('\"/zoom-only/app/action\"', '\"./zoom-only/app/action\"')`));
  assert.ok(source.includes(`.replaceAll('\"/zoom-only/library/status\"', '\"./zoom-only/library/status\"')`));
  assert.match(source, /"\/zoom-only\/library\/import"/u);
  assert.match(source, /new URLSearchParams\(search\)/u);
  assert.match(source, /url\.pathname, url\.search/u);
  assert.doesNotMatch(source, /child_process|exec\(|spawn\(/u);
});

test("control compose uses host network but binds the agent to localhost", async () => {
  const fs = await import("node:fs/promises");
  const compose = await fs.readFile(new URL("../control-agent.compose.example.yml", import.meta.url), "utf8");
  assert.match(compose, /network_mode:\s*host/u);
  assert.match(compose, /ZOOM_CONTROL_HOST:\s*127\.0\.0\.1/u);
  assert.match(compose, /ZOOM_CONTROL_HEALTH_URL:\s*http:\/\/127\.0\.0\.1:3097\/health/u);
  assert.doesNotMatch(compose, /ZOOM_CONTROL_HOST:\s*0\.0\.0\.0/u);
  assert.match(compose, /nafanya-zoom-control/u);
  assert.match(compose, /\/var\/run\/docker\.sock/u);
  assert.doesNotMatch(compose, /ZOOM_CONTROL_TOKEN:\s*\S+/u);
});

test("start timeout becomes error instead of returning to starting", async () => {
  let running = false;
  const ops = fakeOps({
    async isSenderRunning() { return running; },
    async startSender() { running = true; },
    async getSenderHealth() { return { status: "warning", zoomJoined: false, chatOpen: false, lastError: null }; },
    async sleep() { await new Promise((resolve) => setTimeout(resolve, 2)); }
  });
  const service = new ZoomControlService(ops, { startTimeoutMs: 5, pollMs: 1 });
  service.requestStart();
  await new Promise((resolve) => setTimeout(resolve, 12));
  const status = await service.status();
  assert.equal(status.mode, "error");
  assert.match(status.lastError, /не успел/iu);
});

test("stop after start timeout returns off and safe mode", async () => {
  let running = true;
  const ops = fakeOps({
    async isSenderRunning() { return running; },
    async stopSender() { ops.calls.push("stop-sender"); running = false; }
  });
  const service = new ZoomControlService(ops);
  service.lastMode = "error";
  service.lastError = "timeout";
  const stopped = await service.stop();
  assert.equal(stopped.mode, "off");
  assert.deepEqual(ops.calls, ["stop-sender", "mode:safe"]);
  assert.equal((await service.status()).mode, "off");
});

test("auth setup exposes protected view state and closes it after completion", async () => {
  let authState = "waiting";
  const ops = fakeOps({
    async getAuthSetupState() { const state = authState; authState = "completed"; return { state }; },
    async sleep() { await new Promise((resolve) => setTimeout(resolve, 3)); }
  });
  const service = new ZoomControlService(ops, { authTimeoutMs: 50, pollMs: 1 });
  assert.equal(service.requestAuthSetup().accepted, true);
  assert.equal((await service.status()).authViewAvailable, false);
  await new Promise((resolve) => setTimeout(resolve, 2));
  assert.deepEqual(ops.calls.slice(0, 4), ["stop-sender", "clear-locks", "mode:auth", "auth-setup:start"]);
  const waiting = await service.status();
  assert.equal(waiting.authSetupState, "auth_setup_waiting_for_manual_action");
  assert.equal(waiting.authViewAvailable, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const completed = await service.status();
  assert.equal(completed.mode, "auth_setup_completed");
  assert.equal(completed.authViewAvailable, false);
  assert.ok(ops.calls.includes("auth-setup:stop"));
  assert.ok(ops.calls.includes("mode:safe"));
});

test("stuck auth setup can be stopped and returns safe mode", async () => {
  const ops = fakeOps({ async getAuthSetupState() { return { state: "waiting" }; }, async sleep() { await new Promise((resolve) => setTimeout(resolve, 2)); } });
  const service = new ZoomControlService(ops, { authTimeoutMs: 100, pollMs: 1 });
  service.requestAuthSetup();
  await new Promise((resolve) => setTimeout(resolve, 4));
  const stopped = await service.stopAuthSetup();
  assert.equal(stopped.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const status = await service.status();
  assert.equal(status.mode, "auth_setup_failed");
  assert.match(status.lastError, /остановлено/iu);
  assert.ok(ops.calls.includes("mode:safe"));
});

test("auth view uses fixed docker compose commands without arbitrary shell", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../control-agent/docker-ops.mjs", import.meta.url), "utf8");
  assert.match(source, /--service-ports/u);
  assert.match(source, /startAuthSetup/u);
  assert.match(source, /stopAuthSetup/u);
  assert.match(source, /import \{ execFile \} from "node:child_process"/u);
  assert.doesNotMatch(source, /import \{[^}]*\b(?:exec|spawn)\b[^}]*\} from "node:child_process"|shell:\s*true/u);
});

test("Docker auth view binds noVNC to localhost and has no embedded secret", async () => {
  const fs = await import("node:fs/promises");
  const compose = await fs.readFile(new URL("../compose.example.yml", import.meta.url), "utf8");
  const dockerfile = await fs.readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(compose, /127\.0\.0\.1:6080:6080/u);
  assert.match(dockerfile, /novnc|websockify/u);
  assert.match(dockerfile, /x11vnc/u);
  assert.doesNotMatch(dockerfile, /ZOOM_AUTH_(?:EMAIL|PASSWORD)=\S+/u);
});
