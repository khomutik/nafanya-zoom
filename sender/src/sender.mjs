export class ZoomSenderService {
  constructor({ workerClient, zoomAdapter, backoff, health, logger = console, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now(), zoomRecoveryAfterMs = 180000 }) {
    this.workerClient = workerClient;
    this.zoomAdapter = zoomAdapter;
    this.backoff = backoff;
    this.health = health;
    this.logger = logger;
    this.sleep = sleep;
    this.now = now;
    this.zoomRecoveryAfterMs = zoomRecoveryAfterMs;
    this.stopped = false;
    this.started = false;
    this.zoomUnreadySince = null;
  }

  async start() {
    const presence = await this.zoomAdapter.start();
    this.health.updateZoom(presence);
    this.health.updateBackoff(this.backoff);
    this.started = true;
    this.zoomUnreadySince = this.#isReady(presence) || presence?.waitingRoom ? null : this.now();
  }

  #isReady(presence) {
    return Boolean(presence?.zoomPageOpen && presence?.zoomJoined && presence?.chatOpen);
  }

  async #recoverZoom(reason) {
    this.logger.warn?.(`Zoom Sender is recovering the browser: ${reason}`);
    const presence = typeof this.zoomAdapter.restart === "function"
      ? await this.zoomAdapter.restart()
      : (await this.zoomAdapter.stop?.(), await this.zoomAdapter.start());
    this.health.updateZoom(presence);
    this.zoomUnreadySince = this.#isReady(presence) || presence?.waitingRoom ? null : this.now();
    return presence;
  }

  async runOnce() {
    try {
      let presence;
      try {
        presence = await this.zoomAdapter.getPresence();
      } catch {
        presence = await this.#recoverZoom("presence_failed");
      }
      this.health.updateZoom(presence);
      if (!this.#isReady(presence)) {
        const now = this.now();
        if (presence?.waitingRoom) {
          this.zoomUnreadySince = null;
          this.health.clearError();
        } else {
          if (this.zoomUnreadySince === null) this.zoomUnreadySince = now;
          const pageClosed = !presence?.zoomPageOpen;
          const stalled = !presence?.chatUnavailable && now - this.zoomUnreadySince >= this.zoomRecoveryAfterMs;
          if (pageClosed || stalled) presence = await this.#recoverZoom(pageClosed ? "page_closed" : "join_stalled");
        }
        if (!this.#isReady(presence)) {
          const delay = this.backoff.onMessages(0);
          this.health.updateBackoff(this.backoff);
          return { messages: 0, ackIds: [], delayMs: delay, waitingForZoom: true };
        }
      }
      this.zoomUnreadySince = null;
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
    while (!this.stopped) {
      if (!this.started) {
        try {
          await this.start();
        } catch (error) {
          const delay = this.backoff.onError();
          this.health.markError(error);
          this.health.updateBackoff(this.backoff);
          this.logger.warn?.(`Zoom Sender startup failed; retrying in ${delay}ms: ${this.health.lastError?.message || "unknown error"}`);
          await this.zoomAdapter.stop?.().catch(() => null);
          if (!this.stopped) await this.sleep(delay);
          continue;
        }
      }
      const result = await this.runOnce();
      if (!this.stopped) await this.sleep(result.delayMs || this.backoff.currentDelayMs);
    }
  }

  async stop() {
    this.stopped = true;
    this.started = false;
    await this.zoomAdapter.stop?.();
  }
}
