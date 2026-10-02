import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const senderDir = path.resolve(import.meta.dirname, "..");
const workerDir = path.resolve(senderDir, "..", "cloudflare-deploy");
function loadEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/u).map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u)).filter(Boolean).map(([, key, value]) => [key, value.replace(/^['"]|['"]$/gu, "")]));
}
const localEnv = { ...process.env, ...loadEnv(path.join(senderDir, ".env.local")) };
const env = {
  ...localEnv, WORKER_BASE_URL: localEnv.WORKER_BASE_URL || "http://127.0.0.1:8787", ZOOM_CONTROL_LOCAL_MODE: "true",
  ZOOM_CONTROL_PROJECT_DIR: senderDir, ZOOM_CONTROL_ENV_PATH: path.join(senderDir, ".env.local"),
  ZOOM_CONTROL_PROFILE_DIR: localEnv.ZOOM_SENDER_USER_DATA_DIR || path.join(senderDir, ".local-profile"),
  ZOOM_CONTROL_DIAGNOSTICS_DIR: localEnv.ZOOM_SENDER_DIAGNOSTICS_DIR || path.join(senderDir, "diagnostics"),
  ZOOM_CONTROL_HEALTH_URL: localEnv.ZOOM_CONTROL_HEALTH_URL || "http://127.0.0.1:3097/health", ZOOM_CONTROL_PORT: localEnv.ZOOM_CONTROL_PORT || "3098",
  ZOOM_CONTROL_TOKEN: localEnv.ZOOM_CONTROL_TOKEN || "local-control-token", ZOOM_PANEL_TOKEN: localEnv.ZOOM_PANEL_TOKEN || "local-panel-token",
  ZOOM_ONLY_SECRET: localEnv.ZOOM_ONLY_SECRET || "local-bridge-secret", ZOOM_SENDER_DRY_RUN: "false", ZOOM_SENDER_MOCK_OUTBOX: "false", HEADLESS: localEnv.HEADLESS || "false"
};
if (!env.ZOOM_MEETING_URL || /pochti-normalnye\.workers\.dev|5487249245/iu.test(env.ZOOM_MEETING_URL)) throw new Error("\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u0443\u044e \u0442\u0435\u0441\u0442\u043e\u0432\u0443\u044e ZOOM_MEETING_URL \u0432 zoom-sender/.env.local (PMI \u0438 production \u0437\u0430\u043f\u0440\u0435\u0449\u0435\u043d\u044b).");
let workerUrl;
try { workerUrl = new URL(env.WORKER_BASE_URL); } catch { workerUrl = null; }
if (!workerUrl || !["127.0.0.1", "localhost", "::1"].includes(workerUrl.hostname)) throw new Error("\u041b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0439 Worker \u0434\u043e\u043b\u0436\u0435\u043d \u0431\u044b\u0442\u044c \u043d\u0430 127.0.0.1.");
const children = [
  spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler", "dev", "--config", "wrangler.local.jsonc", "--local", "--port", "8787"], { cwd: workerDir, env, stdio: "inherit", windowsHide: false }),
  spawn(process.execPath, [path.join(senderDir, "control-agent", "main.mjs")], { cwd: senderDir, env, stdio: "inherit", windowsHide: false })
];
async function seedLibrary() {
  const payload = readFileSync(path.join(workerDir, "local_library_seed.json"), "utf8");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`${env.WORKER_BASE_URL}/zoom-only/library/import`, { method: "POST", headers: { "x-nafanya-zoom-panel-token": env.ZOOM_PANEL_TOKEN, "content-type": "application/json" }, body: payload });
      if (response.ok) { console.log("Local Zoom library seed loaded."); return; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.warn("Local Zoom library seed was not loaded; import it from the panel if excerpts are needed.");
}
void seedLibrary();
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  try { await fetch(`http://127.0.0.1:${env.ZOOM_CONTROL_PORT}/api/stop`, { method: "POST", headers: { "x-nafanya-control-token": env.ZOOM_CONTROL_TOKEN } }); } catch {}
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
  setTimeout(() => { for (const child of children) if (!child.killed) child.kill("SIGKILL"); process.exit(0); }, 3000).unref();
}
process.on("SIGINT", stop); process.on("SIGTERM", stop);
console.log("Local Zoom debug: Worker http://127.0.0.1:8787, control http://127.0.0.1:3098. \u041d\u0430\u0436\u043c\u0438\u0442\u0435 «\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u041d\u0430\u0444\u0430\u043d\u044e» \u0432 \u043f\u0443\u043b\u044c\u0442\u0435.");
