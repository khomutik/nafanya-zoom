export class DryRunZoomSender {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.sentMessages = [];
    this.presence = {
      zoomPageOpen: false,
      zoomJoined: false,
      waitingRoom: false,
      chatOpen: false
    };
  }

  async start() {
    this.logger.info?.("Zoom Sender dry-run adapter started; real Zoom chat will not be touched.");
    return this.presence;
  }

  async sendMessage(text) {
    this.sentMessages.push(String(text || ""));
    this.logger.info?.(`DRY-RUN would send Zoom message (${String(text || "").length} chars)`);
    return { sent: true, ack: true, dryRun: true };
  }

  async getPresence() {
    return { ...this.presence };
  }

  async stop() {
  }
}
