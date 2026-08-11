export class Backoff {
  constructor({ minIntervalMs = 1500, maxIntervalMs = 1500, errorIntervalMs = 10000 } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.maxIntervalMs = Math.max(maxIntervalMs, minIntervalMs);
    this.errorIntervalMs = Math.max(errorIntervalMs, minIntervalMs);
    this.currentDelayMs = minIntervalMs;
  }

  onMessages(count) {
    this.currentDelayMs = count > 0 ? this.minIntervalMs : Math.min(this.maxIntervalMs, Math.max(this.minIntervalMs, this.currentDelayMs * 2));
    return this.currentDelayMs;
  }

  onError() {
    this.currentDelayMs = this.errorIntervalMs;
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
