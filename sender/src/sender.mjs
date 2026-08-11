export class ZoomSenderService {
  constructor({ workerClient, zoomAdapter, backoff, health, logger = console, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    this.workerClient = workerClient;
    this.zoomAdapter = zoomAdapter;
    this.backoff = backoff;
    this.health = health;
    this.logger = logger;
    this.sleep = sleep;
    this.stopped = false;
  }

  async start() {
    const presence = await this.zoomAdapter.start();
    this.health.updateZoom(presence);
    this.health.updateBackoff(this.backoff);
  }

  async runOnce() {
    try {
      this.health.updateZoom(await this.zoomAdapter.getPresence());
      await this.zoomAdapter.observeChatDiagnostics?.();
      const pulled = await this.workerClient.pull();
      this.health.markWorkerPoll();
      const messages = Array.isArray(pulled.messages) ? pulled.messages : [];
      if (!messages.length) {
        const delay = this.backoff.onMessages(0);
        this.health.updateBackoff(this.backoff);
        this.health.clearError();
        return { messages: 0, ackIds: [], delayMs: delay };
      }

      const ackIds = [];
      for (const message of messages) {
        const id = Number(message.id);
        const text = String(message.text || "").trim();
        if (!id || !text) continue;
        const result = await this.zoomAdapter.sendMessage(text);
        this.health.updateZoom(await this.zoomAdapter.getPresence());
        if (result?.sent && result?.ack) {
          ackIds.push(id);
          this.health.markSend();
        } else {
          this.logger.warn?.(`Zoom Sender did not ack message ${id}: send result was not successful`);
        }
      }

      if (ackIds.length) {
        await this.workerClient.ack(ackIds);
        this.logger.info?.(`Zoom Sender acknowledged ${ackIds.length} outbox message(s)`);
      }
      const delay = this.backoff.onMessages(messages.length);
      this.health.updateBackoff(this.backoff);
      this.health.clearError();
      return { messages: messages.length, ackIds, delayMs: delay };
    } catch (error) {
      const delay = this.backoff.onError();
      this.health.markWorkerUnavailable?.(error);
      this.health.markError(error);
      this.health.updateBackoff(this.backoff);
      this.logger.warn?.(`Zoom Sender cycle failed; next poll in ${delay}ms: ${this.health.lastError?.message || "unknown error"}`);
      return { error, ackIds: [], delayMs: delay };
    }
  }

  async runForever() {
    await this.start();
    while (!this.stopped) {
      const result = await this.runOnce();
      await this.sleep(result.delayMs || this.backoff.currentDelayMs);
    }
  }

  async stop() {
    this.stopped = true;
    await this.zoomAdapter.stop?.();
  }
}
