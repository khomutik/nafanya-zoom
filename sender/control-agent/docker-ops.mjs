import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);
const SAFE_VALUES = {
  safe: {
    ZOOM_SENDER_DRY_RUN: "true",
    ZOOM_SENDER_MOCK_OUTBOX: "true",
    ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS: "false",
    ZOOM_AUTH_SETUP: "false",
    ZOOM_AUTH_VIEW_ENABLED: "false"
  },
  live: {
    ZOOM_SENDER_DRY_RUN: "false",
    ZOOM_SENDER_MOCK_OUTBOX: "false",
    ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS: "false",
    ZOOM_AUTH_SETUP: "false",
    ZOOM_AUTH_VIEW_ENABLED: "false"
  },
  auth: {
    ZOOM_SENDER_DRY_RUN: "true",
    ZOOM_SENDER_MOCK_OUTBOX: "true",
    ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS: "false",
    ZOOM_AUTH_SETUP: "true",
    ZOOM_AUTH_VIEW_ENABLED: "true"
  }
};

function updateEnvText(text, values) {
  const lines = String(text || "").replace(/\r/gu, "").split("\n");
  const seen = new Set();
  const updated = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/u);
    if (!match || !(match[1] in values)) return line;
    seen.add(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  });
  for (const [key, value] of Object.entries(values)) if (!seen.has(key)) updated.push(`${key}=${value}`);
  return updated.join("\n").replace(/\n*$/u, "\n");
}

export class DockerOps {
  constructor(config, { exec = execFileAsync, fetchImpl = globalThis.fetch } = {}) {
    this.config = config;
    this.exec = exec;
    this.fetch = fetchImpl;
  }

  async docker(args, options = {}) {
    return this.exec("docker", args, { cwd: this.config.projectDir, timeout: options.timeout || 120000, maxBuffer: 1024 * 1024 });
  }

  composeArgs(command) {
    return ["compose", "-p", "nafanya-zoom-sender", "-f", "compose.example.yml", ...command];
  }

  async isOldBridgeRunning() {
    const { stdout } = await this.docker(["inspect", "-f", "{{.State.Running}}", "nafanya-zoom-bridge"]).catch(() => ({ stdout: "false" }));
    return String(stdout).trim() === "true";
  }

  async isSenderRunning() {
    const { stdout } = await this.docker(["inspect", "-f", "{{.State.Running}}", "nafanya-zoom-sender-v2"]).catch(() => ({ stdout: "false" }));
    return String(stdout).trim() === "true";
  }

  async profileLocks() {
    const entries = await readdir(this.config.profileDir).catch(() => []);
    return entries.filter((name) => ["SingletonLock", "SingletonSocket", "SingletonCookie"].includes(name));
  }

  async clearProfileLocks() {
    if (await this.isSenderRunning()) throw new Error("Нельзя очищать browser profile при работающем sender.");
    for (const name of await this.profileLocks()) await rm(path.join(this.config.profileDir, name), { force: true });
  }

  async setRuntimeMode(mode) {
    const values = SAFE_VALUES[mode];
    if (!values) throw new Error("Unsupported runtime mode");
    const text = await readFile(this.config.envPath, "utf8");
    await writeFile(this.config.envPath, updateEnvText(text, values), { mode: 0o600 });
  }

  async startSender() {
    await this.docker(this.composeArgs(["up", "-d", "zoom-sender"]));
  }

  async stopSender() {
    await this.docker(this.composeArgs(["stop", "zoom-sender"]));
  }

  async getSenderHealth() {
    const response = await this.fetch(this.config.healthUrl, { signal: AbortSignal.timeout(4000) });
    return response.json();
  }

  async detectAuthRequired() {
    const dirs = await readdir(this.config.diagnosticsDir, { withFileTypes: true }).catch(() => []);
    const latest = dirs.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().at(-1);
    if (!latest) return false;
    const snapshot = await readFile(path.join(this.config.diagnosticsDir, latest, "04-after-final-join.json"), "utf8").catch(() => "");
    return /Sign In \| Zoom|Email or phone number|manual verification required/iu.test(snapshot);
  }

  async startAuthSetup() {
    const { stdout } = await this.docker(this.composeArgs(["run", "-d", "--service-ports", "--no-deps", "zoom-sender"]));
    const containerId = String(stdout || "").trim();
    if (!/^[a-f0-9]{12,64}$/iu.test(containerId)) throw new Error("Auth setup container did not start.");
    return containerId;
  }

  async getAuthSetupState(containerId) {
    const { stdout: runningOut } = await this.docker(["inspect", "-f", "{{.State.Running}}", containerId]).catch(() => ({ stdout: "false" }));
    const { stdout = "", stderr = "" } = await this.docker(["logs", "--tail", "120", containerId]).catch(() => ({ stdout: "", stderr: "" }));
    const output = `${stdout}\n${stderr}`;
    if (/Zoom auth profile setup completed/iu.test(output)) return { state: "completed" };
    if (/waiting for manual verification/iu.test(output)) return { state: "waiting" };
    if (/Zoom auth profile setup failed|fatal error/iu.test(output)) return { state: "failed" };
    return { state: String(runningOut).trim() === "true" ? "starting" : "failed" };
  }

  async stopAuthSetup(containerId) {
    if (containerId && /^[a-f0-9]{12,64}$/iu.test(containerId)) {
      await this.docker(["stop", "-t", "10", containerId], { timeout: 20000 }).catch(() => null);
      await this.docker(["rm", "-f", containerId], { timeout: 20000 }).catch(() => null);
    }
  }

  sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
}

export { SAFE_VALUES, updateEnvText };
