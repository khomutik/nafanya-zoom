const DEFAULT_START_TIMEOUT_MS = 90000;
const DEFAULT_AUTH_TIMEOUT_MS = 600000;

function safeError(error) {
  const text = String(error?.message || error || "unknown error");
  return text
    .replace(/([?&](?:token|pwd|passcode)=)[^&\s]+/giu, "$1[redacted]")
    .replace(/(secret|token|password)\s*[:=]\s*\S+/giu, "$1=[redacted]")
    .slice(0, 500);
}

function publicHealth(health = null) {
  if (!health) return null;
  return {
    status: String(health.status || "unhealthy"),
    workerAvailable: Boolean(health.workerAvailable),
    zoomJoined: Boolean(health.zoomJoined),
    waitingRoom: Boolean(health.waitingRoom),
    chatOpen: Boolean(health.chatOpen),
    chatUnavailable: Boolean(health.chatUnavailable),
    chatReason: health.chatReason ? String(health.chatReason) : null,
    lastWorkerError: health.lastWorkerError ? {
      reason: String(health.lastWorkerError.reason || "unknown"),
      httpStatus: Number.isInteger(health.lastWorkerError.httpStatus) ? health.lastWorkerError.httpStatus : null,
      message: safeError(health.lastWorkerError.message || "")
    } : null,
    lastError: health.lastError ? safeError(health.lastError?.message || health.lastError) : null
  };
}

function workerUnavailableMessage(health) {
  const reason = health?.lastWorkerError?.reason || "unknown";
  const status = Number.isInteger(health?.lastWorkerError?.httpStatus) ? ` HTTP ${health.lastWorkerError.httpStatus}` : "";
  return `Worker \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d: ${reason}${status}.`;
}

export class ZoomControlService {
  constructor(ops, { startTimeoutMs = DEFAULT_START_TIMEOUT_MS, authTimeoutMs = DEFAULT_AUTH_TIMEOUT_MS, pollMs = 2000 } = {}) {
    this.ops = ops;
    this.startTimeoutMs = startTimeoutMs;
    this.pollMs = pollMs;
    this.authTimeoutMs = authTimeoutMs;
    this.operation = null;
    this.lastMode = "off";
    this.lastError = null;
    this.authSetupState = "auth_setup_idle";
    this.authContainerId = null;
    this.authCancelled = false;
  }

  async status() {
    const running = await this.ops.isSenderRunning();
    const health = running ? await this.ops.getSenderHealth().catch(() => null) : null;
    let mode = running ? "starting" : "off";
    if (this.operation === "start") mode = "starting";
    else if (this.operation === "stop") mode = "stopping";
    else if (this.operation === "auth-setup" || this.authSetupState !== "auth_setup_idle") mode = this.authSetupState;
    else if (running && health?.status === "healthy" && health?.zoomJoined && health?.chatOpen) {
      mode = "ready";
      this.lastError = null;
    }
    else if (running && health?.zoomJoined && health?.chatUnavailable) {
      mode = "error";
      this.lastError = "\u0412\u0441\u0442\u0440\u0435\u0447\u0430 \u043e\u0442\u043a\u0440\u044b\u0442\u0430, \u043d\u043e \u0447\u0430\u0442 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d.";
    }
    else if (running && health?.lastWorkerError && !health?.workerAvailable) {
      mode = "error";
      this.lastError = workerUnavailableMessage(health);
    }
    else if (running && health?.zoomJoined && !health?.waitingRoom && !health?.chatOpen) {
      mode = "error";
      this.lastError = "\u041d\u0430\u0444\u0430\u043d\u044f \u0432\u043e\u0448\u0451\u043b \u0432 Zoom, \u043d\u043e \u0447\u0430\u0442 \u043d\u0435 \u043e\u0442\u043a\u0440\u044b\u043b\u0441\u044f.";
    }
    else if (running && await this.ops.detectAuthRequired().catch(() => false)) mode = "auth_required";
    else if (running && health?.status === "unhealthy") mode = "error";
    else if (running && this.lastMode === "error" && this.lastError) mode = "error";
    else if (!running && this.lastMode === "auth_required") mode = "auth_required";
    else if (!running && this.lastMode === "error" && this.lastError && !/не успел войти в Zoom и открыть чат/iu.test(this.lastError)) mode = "error";
    else if (!running) this.lastError = null;
    this.lastMode = mode;
    return { running, health: publicHealth(health), mode, authSetupState: this.authSetupState, authViewAvailable: this.authSetupState === "auth_setup_waiting_for_manual_action", lastError: this.lastError };
  }

  requestStart() {
    if (this.operation) return { accepted: false, reason: "operation_in_progress" };
    this.operation = "start";
    this.authSetupState = "auth_setup_idle";
    this.lastError = null;
    void this.#start().finally(() => { this.operation = null; });
    return { accepted: true, mode: "starting" };
  }

  async #start() {
    try {
      if (await this.ops.isOldBridgeRunning()) throw new Error("Старый Zoom bridge запущен. Позовите администратора.");
      if (!await this.ops.isSenderRunning()) {
        const locks = await this.ops.profileLocks();
        if (locks.length) await this.ops.clearProfileLocks();
        await this.ops.setRuntimeMode("live");
        await this.ops.startSender();
      }
      const deadline = Date.now() + this.startTimeoutMs;
      while (Date.now() < deadline) {
        const health = await this.ops.getSenderHealth().catch(() => null);
        if (health?.status === "healthy" && health.zoomJoined && health.chatOpen) {
          this.lastMode = "ready";
          return;
        }
        if (health?.zoomJoined && health?.chatUnavailable) {
          this.lastMode = "error";
          this.lastError = "\u0412\u0441\u0442\u0440\u0435\u0447\u0430 \u043e\u0442\u043a\u0440\u044b\u0442\u0430, \u043d\u043e \u0447\u0430\u0442 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d.";
          return;
        }
        if (health?.lastWorkerError && !health?.workerAvailable) {
          this.lastMode = "error";
          this.lastError = workerUnavailableMessage(health);
          return;
        }
        if (await this.ops.detectAuthRequired().catch(() => false)) {
          this.lastMode = "auth_required";
          return;
        }
        await this.ops.sleep(this.pollMs);
      }
      this.lastMode = "error";
      this.lastError = "Нафаня не успел войти в Zoom и открыть чат.";
    } catch (error) {
      this.lastMode = "error";
      this.lastError = safeError(error);
    }
  }

  async stop() {
    if (this.operation) return { ok: false, status: 409, error: "Дождитесь завершения текущей операции." };
    this.operation = "stop";
    try {
      await this.ops.stopSender();
      await this.ops.setRuntimeMode("safe");
      this.lastMode = "off";
      this.lastError = null;
      return { ok: true, status: 200, mode: "off" };
    } catch (error) {
      this.lastMode = "error";
      this.lastError = safeError(error);
      return { ok: false, status: 500, error: this.lastError };
    } finally {
      this.operation = null;
    }
  }

  requestAuthSetup() {
    if (this.operation) return { accepted: false, reason: "operation_in_progress" };
    this.operation = "auth-setup";
    this.authSetupState = "auth_setup_starting";
    this.authCancelled = false;
    this.lastError = null;
    void this.#authSetup().finally(() => { this.operation = null; });
    return { accepted: true, mode: "auth_setup_starting" };
  }

  async #authSetup() {
    try {
      await this.ops.stopSender();
      await this.ops.clearProfileLocks();
      await this.ops.setRuntimeMode("auth");
      this.authContainerId = await this.ops.startAuthSetup();
      const deadline = Date.now() + this.authTimeoutMs;
      while (!this.authCancelled && Date.now() < deadline) {
        const result = await this.ops.getAuthSetupState(this.authContainerId);
        if (result.state === "completed") {
          this.authSetupState = "auth_setup_completed";
          this.lastMode = "off";
          this.lastError = null;
          return;
        }
        if (result.state === "failed") throw new Error("Zoom auth setup failed.");
        if (result.state === "waiting") this.authSetupState = "auth_setup_waiting_for_manual_action";
        await this.ops.sleep(this.pollMs);
      }
      if (this.authCancelled) throw new Error("Auth setup stopped by user.");
      throw new Error("Zoom auth setup timed out.");
    } catch (error) {
      this.authSetupState = "auth_setup_failed";
      this.lastMode = "auth_required";
      this.lastError = this.authCancelled ? "Восстановление входа остановлено." : "Не удалось сохранить вход Zoom. Позовите Машу или администратора.";
    } finally {
      await this.ops.stopAuthSetup(this.authContainerId).catch(() => null);
      await this.ops.setRuntimeMode("safe").catch(() => null);
      await this.ops.clearProfileLocks().catch(() => null);
      this.authContainerId = null;
    }
  }

  async stopAuthSetup() {
    if (this.operation !== "auth-setup") return { ok: false, status: 409, error: "Восстановление входа сейчас не запущено." };
    this.authCancelled = true;
    await this.ops.stopAuthSetup(this.authContainerId).catch(() => null);
    return { ok: true, status: 202, mode: "auth_setup_failed" };
  }
}

export { publicHealth, safeError };
