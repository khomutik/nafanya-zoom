function readBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/iu.test(String(value).trim());
}

function readPositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function readList(value) {
  return String(value || "")
    .split(/\s+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  const minIntervalMs = readPositiveInt(env.ZOOM_SENDER_MIN_POLL_MS ?? env.ZOOM_SENDER_MIN_INTERVAL_MS, 1500, { min: 1000, max: 60000 });
  const maxIntervalMs = readPositiveInt(env.ZOOM_SENDER_MAX_POLL_MS ?? env.ZOOM_SENDER_MAX_INTERVAL_MS, 1500, { min: minIntervalMs, max: 120000 });
  return {
    workerBaseUrl: String(env.WORKER_BASE_URL || "").replace(/\/+$/u, ""),
    zoomMeetingUrl: String(env.ZOOM_MEETING_URL || "").trim(),
    participantName: String(env.ZOOM_DISPLAY_NAME ?? env.ZOOM_PARTICIPANT_NAME ?? "Nafanya").trim(),
    zoomBridgeSecret: String(env.ZOOM_ONLY_SECRET ?? env.ZOOM_BRIDGE_SECRET ?? "").trim(),
    outboxMeetingId: String(env.ZOOM_SENDER_OUTBOX_MEETING_ID || "").replace(/[^0-9A-Za-z_-]/gu, "").slice(0, 128),
    dryRun: readBool(env.ZOOM_SENDER_DRY_RUN, false),
    mockOutbox: readBool(env.ZOOM_SENDER_MOCK_OUTBOX, false),
    mockMessage: String(env.ZOOM_SENDER_MOCK_MESSAGE || "Dry-run Zoom message").trim(),
    chatReadonlyDiagnostics: readBool(env.ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS, false),
    headless: readBool(env.HEADLESS ?? env.ZOOM_SENDER_HEADLESS, true),
    userDataDir: String(env.ZOOM_SENDER_USER_DATA_DIR || "/app/profile").trim(),
    diagnosticsDir: String(env.ZOOM_SENDER_DIAGNOSTICS_DIR || (readBool(env.ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS, false) ? "/app/diagnostics" : "")).trim(),
    browserArgs: readList(env.ZOOM_SENDER_BROWSER_ARGS),
    minIntervalMs,
    maxIntervalMs,
    errorIntervalMs: readPositiveInt(env.ZOOM_SENDER_ERROR_POLL_MS ?? env.ZOOM_SENDER_ERROR_INTERVAL_MS, 10000, { min: 1000, max: 120000 }),
    zoomRecoveryAfterMs: readPositiveInt(env.ZOOM_SENDER_RECOVERY_AFTER_MS, 180000, { min: 30000, max: 900000 }),
    outboxLimit: readPositiveInt(env.ZOOM_SENDER_OUTBOX_LIMIT, 20, { min: 1, max: 50 }),
    healthHost: String(env.ZOOM_SENDER_HEALTH_HOST || "127.0.0.1").trim() || "127.0.0.1",
    healthPort: readPositiveInt(env.ZOOM_SENDER_HEALTH_PORT, 3097, { min: 1, max: 65535 })
  };
}

export function validateConfig(config) {
  const missing = [];
  if (!config.mockOutbox && !config.workerBaseUrl) missing.push("WORKER_BASE_URL");
  if (!config.mockOutbox && !config.zoomBridgeSecret) missing.push("ZOOM_BRIDGE_SECRET");
  if (!config.dryRun && !config.zoomMeetingUrl) missing.push("ZOOM_MEETING_URL");
  if (missing.length) {
    throw new Error(`Missing required config: ${missing.join(", ")}`);
  }
}
