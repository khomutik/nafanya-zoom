export class WorkerOutboxClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== "function") {
      throw new Error("fetch implementation is required");
    }
    this.config = config;
    this.fetch = fetchImpl;
    this.outboxPath = "/zoom-only/outbox";
  }

  async postOutbox(payload = {}) {
    const response = await this.requestWorker(`${this.config.workerBaseUrl}${this.outboxPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nafanya-zoom-secret": this.config.zoomBridgeSecret
      },
      body: JSON.stringify({
        ...payload,
        ...(this.config.outboxMeetingId ? { meetingId: this.config.outboxMeetingId } : {})
      })
    }, "outbox");
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new WorkerRequestError(data.error || `Worker outbox request failed with HTTP ${response.status}`, {
        reason: classifyWorkerHttpStatus(response.status),
        httpStatus: response.status
      });
    }
    return data;
  }

  async pull({ limit = this.config.outboxLimit } = {}) {
    return this.postOutbox({ limit });
  }

  async ack(ids = []) {
    const ackIds = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
    if (!ackIds.length) return { ok: true, remaining: null };
    return this.postOutbox({ ackIds, limit: this.config.outboxLimit });
  }

  async requestWorker(url, init, label) {
    if (!this.config.workerBaseUrl) {
      throw new WorkerRequestError(`Worker ${label} request failed: missing config`, { reason: "missing_config" });
    }
    if (!this.config.zoomBridgeSecret) {
      throw new WorkerRequestError(`Worker ${label} request failed: missing secret`, { reason: "missing_config" });
    }
    try {
      return await this.fetch(url, init);
    } catch (error) {
      throw new WorkerRequestError(`Worker ${label} request failed: ${classifyWorkerFetchError(error)}`, {
        reason: classifyWorkerFetchError(error),
        cause: error
      });
    }
  }
}

export class WorkerRequestError extends Error {
  constructor(message, { reason = "unknown", httpStatus = null, cause = null } = {}) {
    super(redactWorkerErrorText(message), cause ? { cause } : undefined);
    this.name = "WorkerRequestError";
    this.workerReason = reason;
    this.httpStatus = httpStatus;
  }
}

function redactWorkerErrorText(value) {
  return String(value || "")
    .replace(/(secret|token|key|password)\s*[:=]\s*[^"',\s]+/giu, "$1=[redacted]")
    .replace(/(x-nafanya-zoom-secret["'\s:=]+)[^"',\s]+/giu, "$1[redacted]")
    .replace(/([?&](?:pwd|zak|token|secret|code|signature|passcode)=)[^&\s"'<>]+/giu, "$1[redacted]");
}

export function classifyWorkerHttpStatus(status) {
  const code = Number(status);
  if (code === 401 || code === 403) return "auth";
  if (code === 408 || code === 429) return "timeout";
  if (code >= 500) return "server";
  if (code >= 400) return "client";
  return "unknown";
}

export function classifyWorkerFetchError(error) {
  const text = String(error?.name || error?.message || error || "").toLowerCase();
  if (/abort|timeout|timed out|etimedout/u.test(text)) return "timeout";
  if (/enotfound|econnrefused|econnreset|network|fetch failed|socket|dns/u.test(text)) return "network";
  return "network";
}
