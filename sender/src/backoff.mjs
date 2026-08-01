export class Backoff {
  constructor({ minIntervalMs = 1500, maxIntervalMs = 30000, errorIntervalMs = 10000 } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.maxIntervalMs = Math.max(maxIntervalMs, minIntervalMs);
    this.errorIntervalMs = Math.min(Math.max(errorIntervalMs, minIntervalMs), this.maxIntervalMs);
    this.currentDelayMs = minIntervalMs;
  }

  onMessages(count) {
    this.currentDelayMs = count > 0 ? this.minIntervalMs : Math.min(this.maxIntervalMs, Math.max(this.minIntervalMs, this.currentDelayMs * 2));
    return this.currentDelayMs;
  }

  onError() {
    this.currentDelayMs = Math.min(this.maxIntervalMs, Math.max(this.errorIntervalMs, this.currentDelayMs * 2));
    return this.currentDelayMs;
  }

  snapshot() {
    return {
      currentDelayMs: this.currentDelayMs,
      minIntervalMs: this.minIntervalMs,
      maxIntervalMs: this.maxIntervalMs,
      errorIntervalMs: this.errorIntervalMs
    };
  }
}
