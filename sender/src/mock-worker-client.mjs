export class MockWorkerOutboxClient {
  constructor(config) {
    this.config = config;
    this.nextId = 1;
    this.messages = [{
      id: this.nextId,
      text: config.mockMessage || "Dry-run Zoom message"
    }];
    this.nextId += 1;
    this.acked = [];
  }

  async pull() {
    return { ok: true, messages: [...this.messages] };
  }

  async ack(ids = []) {
    const idSet = new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id)));
    this.acked.push(...idSet);
    this.messages = this.messages.filter((message) => !idSet.has(Number(message.id)));
    return { ok: true, remaining: this.messages.length };
  }
}
