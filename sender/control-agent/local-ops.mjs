import { spawn } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

export class LocalProcessOps {
  constructor(config, { spawnImpl = spawn, fetchImpl = globalThis.fetch } = {}) {
    this.config = config;
    this.spawnImpl = spawnImpl;
    this.fetch = fetchImpl;
    this.child = null;
    this.mode = "safe";
  }

  async isOldBridgeRunning() { return false; }
  async isSenderRunning() { return Boolean(this.child && this.child.exitCode === null && !this.child.killed); }

  async profileLocks() {
    const entries = await readdir(this.config.profileDir).catch(() => []);
    return entries.filter((name) => ["SingletonLock", "SingletonSocket", "SingletonCookie"].includes(name));
  }

  async clearProfileLocks() {
    if (await this.isSenderRunning()) throw new Error("\u041d\u0435\u043b\u044c\u0437\u044f \u043e\u0447\u0438\u0449\u0430\u0442\u044c browser profile \u043f\u0440\u0438 \u0440\u0430\u0431\u043e\u0442\u0430\u044e\u0449\u0435\u043c sender.");
    for (const name of await this.profileLocks()) await rm(path.join(this.config.profileDir, name), { force: true });
  }

  async setRuntimeMode(mode) { this.mode = mode; }

  async startSender() {
    if (await this.isSenderRunning()) return;
    const env = { ...process.env, ZOOM_SENDER_DRY_RUN: "false", ZOOM_SENDER_MOCK_OUTBOX: "false" };
    this.child = this.spawnImpl(process.execPath, [path.join(this.config.projectDir, "src", "main.mjs")], {
      cwd: this.config.projectDir,
      env,
      stdio: "inherit",
      windowsHide: false
    });
    this.child.once("exit", () => { this.child = null; });
  }

  async stopSender() {
    const child = this.child;
    if (!child || child.exitCode !== null) { this.child = null; return; }
    await new Promise((resolve) => {
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve(); }, 15000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.kill("SIGTERM");
    });
    this.child = null;
  }

  async getSenderHealth() {
    const response = await this.fetch(this.config.healthUrl, { signal: AbortSignal.timeout(4000) });
    return response.json();
  }

  async detectAuthRequired() { return false; }
  async startAuthSetup() { throw new Error("\u041b\u043e\u043a\u0430\u043b\u044c\u043d\u0430\u044f \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430 \u0432\u0445\u043e\u0434\u0430 \u0432\u044b\u043f\u043e\u043b\u043d\u044f\u0435\u0442\u0441\u044f \u0432\u0440\u0443\u0447\u043d\u0443\u044e \u0432 \u043e\u043a\u043d\u0435 Zoom."); }
  async getAuthSetupState() { return { state: "failed" }; }
  async stopAuthSetup() {}
  sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
}
