import { DurableObject } from "cloudflare:workers";

const STATE_KEY = "zoom-shared-timer-state";
const DEFAULT_MS = 5 * 60 * 1000;
const MAX_MS = 180 * 60 * 1000;
const EXECUTOR_LEASE_MS = 30 * 1000;

function clampMs(value, fallback = DEFAULT_MS) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(MAX_MS, Math.floor(number))) : fallback;
}

function emptyTimer() {
  return { status: "idle", running: false, baseMs: DEFAULT_MS, remainingMs: DEFAULT_MS, endAt: 0, revision: 0, updatedAt: 0, finishedAt: 0, executor: null, processedRequestIds: [] };
}

function normalizeTimer(value) {
  const source = value && typeof value === "object" ? value : {};
  const baseMs = Math.max(60_000, clampMs(source.baseMs));
  const status = ["idle", "running", "paused", "finished"].includes(source.status) ? source.status : "idle";
  return {
    ...emptyTimer(),
    ...source,
    status,
    running: status === "running" && Boolean(source.running),
    baseMs,
    remainingMs: clampMs(source.remainingMs, baseMs),
    endAt: Math.max(0, Number(source.endAt) || 0),
    revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
    executor: source.executor?.instanceId ? { instanceId: String(source.executor.instanceId).slice(0, 128), leaseUntil: Math.max(0, Number(source.executor.leaseUntil) || 0) } : null,
    processedRequestIds: (Array.isArray(source.processedRequestIds) ? source.processedRequestIds : []).map(String).filter(Boolean).slice(-100)
  };
}

function rememberRequest(timer, requestId) {
  const id = String(requestId || "").trim();
  if (!id) return false;
  if (timer.processedRequestIds.includes(id)) return true;
  timer.processedRequestIds = [...timer.processedRequestIds, id].slice(-100);
  return false;
}

export class ZoomSharedTimerState extends DurableObject {
  async timerAction(payload = {}) {
    return this.ctx.storage.transaction(async (transaction) => {
      const timer = normalizeTimer(await transaction.get(STATE_KEY));
      const now = Date.now();
      const action = String(payload.timerAction || "sync");
      const instanceId = String(payload.instanceId || "").trim().slice(0, 128);
      const product = String(payload.product || "unknown").trim().toLowerCase();
      let changed = false;
      if (timer.running && timer.endAt > 0 && timer.endAt <= now) {
        Object.assign(timer, { status: "finished", running: false, remainingMs: 0, endAt: 0, finishedAt: now, updatedAt: now, revision: timer.revision + 1 });
        changed = true;
      }
      if (product === "desktop" && payload.indicatorSupported === true && instanceId) {
        const expired = !timer.executor || timer.executor.leaseUntil <= now;
        const renew = timer.executor?.instanceId === instanceId && timer.executor.leaseUntil <= now + 10_000;
        if (expired || renew) {
          timer.executor = { instanceId, leaseUntil: now + EXECUTOR_LEASE_MS };
          changed = true;
        }
      }
      const duplicate = action !== "sync" && rememberRequest(timer, payload.requestId);
      if (!duplicate) {
        if (action === "configure" && !timer.running) {
          timer.baseMs = Math.max(60_000, clampMs(payload.baseMs, timer.baseMs));
          Object.assign(timer, { remainingMs: timer.baseMs, status: "idle", endAt: 0, finishedAt: 0, updatedAt: now, revision: timer.revision + 1 });
          changed = true;
        } else if (action === "start") {
          timer.baseMs = Math.max(60_000, clampMs(payload.baseMs, timer.baseMs));
          const requested = clampMs(payload.remainingMs, timer.remainingMs);
          timer.remainingMs = requested > 0 ? requested : timer.baseMs;
          Object.assign(timer, { endAt: now + timer.remainingMs, status: "running", running: true, finishedAt: 0, updatedAt: now, revision: timer.revision + 1 });
          changed = true;
        } else if (action === "pause" && timer.running) {
          Object.assign(timer, { remainingMs: Math.max(0, timer.endAt - now), endAt: 0, status: "paused", running: false, updatedAt: now, revision: timer.revision + 1 });
          changed = true;
        } else if (action === "extend") {
          const deltaMs = Math.max(60_000, Math.min(10 * 60_000, Math.floor(Number(payload.deltaMs) || 0)));
          timer.remainingMs = clampMs((timer.running ? Math.max(0, timer.endAt - now) : timer.remainingMs) + deltaMs, timer.remainingMs);
          if (timer.running) timer.endAt = now + timer.remainingMs;
          Object.assign(timer, { finishedAt: 0, updatedAt: now, revision: timer.revision + 1 });
          changed = true;
        } else if (action === "reset") {
          timer.baseMs = Math.max(60_000, clampMs(payload.baseMs, timer.baseMs));
          Object.assign(timer, { remainingMs: timer.baseMs, endAt: 0, status: "idle", running: false, finishedAt: 0, updatedAt: now, revision: timer.revision + 1 });
          changed = true;
        } else if (action !== "sync" && action !== "configure" && action !== "pause") throw new Error("\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0442\u0430\u0439\u043c\u0435\u0440\u0430.");
      }
      const executorActive = Boolean(timer.executor && timer.executor.leaseUntil > now);
      const isExecutor = Boolean(executorActive && instanceId && timer.executor.instanceId === instanceId);
      if (changed) await transaction.put(STATE_KEY, timer);
      return { ok: true, duplicate, state: timer, serverNow: now, executorActive, isExecutor };
    });
  }
}
