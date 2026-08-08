import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { DockerOps } from "./docker-ops.mjs";
import { ZoomControlService } from "./service.mjs";
import { buildControlHtml } from "./html.mjs";
import { buildZoomAppSessionCookie, decryptZoomAppContext, issueZoomAppSession, verifyZoomAppSession } from "./zoom-app-auth.mjs";

function env(name, fallback = "") { return String(process.env[name] || fallback).trim(); }
const config = {
  host: env("ZOOM_CONTROL_HOST", "127.0.0.1"),
  port: Number(env("ZOOM_CONTROL_PORT", "3098")),
  token: env("ZOOM_CONTROL_TOKEN"),
  cookieName: "nafanya_zoom_control",
  zoomAppCookieName: "nafanya_zoom_app",
  zoomAppClientSecret: env("ZOOM_APP_CLIENT_SECRET"),
  zoomTeamChatTestAppClientSecret: env("ZOOM_TEAM_CHAT_TEST_APP_CLIENT_SECRET"),
  zoomTeamChatTestEnabled: /^(?:1|true|yes)$/iu.test(env("ZOOM_TEAM_CHAT_TEST_ENABLED")),
  zoomTeamChatTestMeetingIds: new Set(env("ZOOM_TEAM_CHAT_TEST_MEETING_IDS").split(",").map((item) => item.replace(/[^0-9A-Za-z_-]/gu, "")).filter(Boolean)),
  zoomAppSessionSecret: env("ZOOM_APP_SESSION_SECRET") || env("ZOOM_APP_CLIENT_SECRET"),
  projectDir: env("ZOOM_CONTROL_PROJECT_DIR", "/workspace"),
  envPath: env("ZOOM_CONTROL_ENV_PATH", "/workspace/.env"),
  profileDir: env("ZOOM_CONTROL_PROFILE_DIR", "/sender-profile"),
  diagnosticsDir: env("ZOOM_CONTROL_DIAGNOSTICS_DIR", "/workspace/diagnostics"),
  workerBaseUrl: env("WORKER_BASE_URL").replace(/\/+$/u, ""),
  zoomOnlySecret: env("ZOOM_ONLY_SECRET") || env("ZOOM_BRIDGE_SECRET"),
  panelToken: env("ZOOM_PANEL_TOKEN") || env("ZOOM_V2_PANEL_TOKEN"),
  appTitle: env("ZOOM_APP_TITLE", "Nafanya Zoom Bridge"),
  healthUrl: env("ZOOM_CONTROL_HEALTH_URL", "http://host.docker.internal:3097/health")
};
if (!config.token || !config.workerBaseUrl || !config.zoomOnlySecret || !config.panelToken) throw new Error("Missing control-agent configuration");

const service = new ZoomControlService(new DockerOps(config));
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const same = (a, b) => { const x = Buffer.from(String(a || "")); const y = Buffer.from(String(b || "")); return x.length === y.length && timingSafeEqual(x, y); };
const cookies = (request) => Object.fromEntries(String(request.headers.cookie || "").split(";").map((item) => item.trim().split("=")).filter(([key]) => key));
const adminAuthorized = (request) => same(cookies(request)[config.cookieName], config.token) || same(request.headers["x-nafanya-control-token"], config.token);
const zoomAppSession = (request) => verifyZoomAppSession(cookies(request)[config.zoomAppCookieName], config.zoomAppSessionSecret);
const zoomAppAuthorized = (request) => Boolean(zoomAppSession(request));
const accessLevel = (request) => adminAuthorized(request) ? "admin" : zoomAppAuthorized(request) ? "zoom_app" : null;
const isTeamChatTestMeeting = (meetingId) => config.zoomTeamChatTestEnabled && config.zoomTeamChatTestMeetingIds.has(String(meetingId || "").replace(/[^0-9A-Za-z_-]/gu, ""));

const zoomAppHtmlHeaders = (sessionCookie = "") => ({
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; object-src 'none'; base-uri 'none'; script-src 'self' 'unsafe-inline' https://appssdk.zoom.us; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'self'",
  "cross-origin-resource-policy": "cross-origin",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  ...(sessionCookie ? { "set-cookie": sessionCookie } : {})
});
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const zoomAppLockedHtml = () => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(config.appTitle)}</title></head><body><p>\u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0432\u043d\u0443\u0442\u0440\u0438 \u043a\u043e\u043d\u0444\u0435\u0440\u0435\u043d\u0446\u0438\u0438 Zoom.</p></body></html>`;

async function proxyWorker(request, res, pathname, search = "", access = "admin") {
  const body = request.method === "POST" ? await new Promise((resolve) => { const chunks = []; request.on("data", (chunk) => chunks.push(chunk)); request.on("end", () => resolve(Buffer.concat(chunks))); }) : undefined;
  const query = new URLSearchParams(search);
  query.set("controlRequest", String(Date.now()));
  const workerPath = `${pathname}?${query}`;
  const response = await fetch(`${config.workerBaseUrl}${workerPath}`, {
    method: request.method,
    headers: { "x-nafanya-zoom-panel-token": config.panelToken, "x-nafanya-zoom-meeting-id": String(zoomAppSession(request)?.mid || ""), "content-type": request.headers["content-type"] || "application/json", "user-agent": "Nafanya-Zoom-Control/1.0" },
    body
  });
  const contentType = response.headers.get("content-type") || "application/json";
  res.writeHead(response.status, { "content-type": contentType, "cache-control": "no-store" });
  if (pathname === "/zoom-only/app" && contentType.includes("text/html")) {
    let html = (await response.text())
      .replaceAll('"/zoom-only/app/action"', '"./zoom-only/app/action"')
      .replaceAll('"/zoom-only/status"', '"./zoom-only/status"')
      .replaceAll('"/zoom-only/library/status"', '"./zoom-only/library/status"')
      .replaceAll('"/zoom-only/library/import"', '"./zoom-only/library/import"')
      .replaceAll('"/zoom-only/team-chat/status"', '"./zoom-only/team-chat/status"')
      .replaceAll('"/zoom-only/team-chat/oauth/start"', '"./zoom-only/team-chat/oauth/start"')
      .replaceAll('"/zoom-only/team-chat/sdk-message"', '"./zoom-only/team-chat/sdk-message"');
    if (access === "zoom_app") html = html.replace('<details class="admin">', '<details class="admin" hidden>');
    return res.end(html);
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = http.createServer(async (request, res) => {
  try {
    const url = new URL(request.url, "http://control.local");
    if (url.pathname === "/health") return json(res, 200, { ok: true });
    if (url.pathname === "/app" && url.searchParams.has("token")) {
      if (!same(url.searchParams.get("token"), config.token)) return json(res, 401, { ok: false });
      res.writeHead(302, { location: "./app", "set-cookie": `${config.cookieName}=${config.token}; HttpOnly; Secure; SameSite=Strict; Path=/nafanya-zoom-control; Max-Age=43200`, "cache-control": "no-store" });
      return res.end();
    }
    if (request.method === "GET" && url.pathname === "/zoom-app") {
      const clientSecrets = [config.zoomAppClientSecret, config.zoomTeamChatTestAppClientSecret].filter(Boolean);
      if (!clientSecrets.length || !config.zoomAppSessionSecret) return json(res, 503, { ok: false, error: "zoom_app_not_configured" });
      try {
        let context = null;
        for (const secret of clientSecrets) {
          try { context = decryptZoomAppContext(request.headers["x-zoom-app-context"], secret); break; } catch {}
        }
        if (!context) throw new Error("zoom_app_context_invalid");
        const session = issueZoomAppSession(context, config.zoomAppSessionSecret);
        res.writeHead(200, zoomAppHtmlHeaders(buildZoomAppSessionCookie(config.zoomAppCookieName, session)));
        return res.end(buildControlHtml({ zoomApp: true, teamChatTest: isTeamChatTestMeeting(context.mid), appTitle: config.appTitle }));
      } catch {
        if (!zoomAppAuthorized(request)) {
          res.writeHead(200, zoomAppHtmlHeaders());
          return res.end(zoomAppLockedHtml());
        }
        res.writeHead(200, zoomAppHtmlHeaders());
        return res.end(buildControlHtml({ zoomApp: true, teamChatTest: isTeamChatTestMeeting(zoomAppSession(request)?.mid), appTitle: config.appTitle }));
      }
    }
    const access = accessLevel(request);
    if (!access) return json(res, 401, { ok: false, error: "unauthorized" });
    if (request.method === "GET" && url.pathname === "/auth/check") {
      if (access !== "admin") return json(res, 403, { ok: false, error: "admin_required" });
      res.writeHead(204, { "cache-control": "no-store" }); return res.end();
    }
    if (request.method === "GET" && url.pathname === "/app") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(buildControlHtml({ appTitle: config.appTitle })); }
    if (request.method === "GET" && url.pathname === "/worker-panel") return proxyWorker(request, res, "/zoom-only/app", url.search, access);
    if (["/zoom-only/status", "/zoom-only/app/action", "/zoom-only/library/status", "/zoom-only/library/import", "/zoom-only/team-chat/status", "/zoom-only/team-chat/oauth/start", "/zoom-only/team-chat/sdk-message"].includes(url.pathname)) {
      if (request.method === "POST" && url.pathname === "/zoom-only/library/import" && access !== "admin") return json(res, 403, { ok: false, error: "admin_required" });
      return proxyWorker(request, res, url.pathname, url.search, access);
    }
    if (request.method === "GET" && url.pathname === "/api/status") return json(res, 200, await service.status());
    if (request.method === "POST" && url.pathname === "/api/start") return json(res, 202, service.requestStart());
    if (request.method === "POST" && url.pathname === "/api/stop") { const result = await service.stop(); return json(res, result.status, result); }
    if (request.method === "POST" && url.pathname === "/api/auth-setup") {
      if (access !== "admin") return json(res, 403, { ok: false, error: "admin_required" });
      return json(res, 202, service.requestAuthSetup());
    }
    if (request.method === "POST" && url.pathname === "/api/auth-setup/stop") {
      if (access !== "admin") return json(res, 403, { ok: false, error: "admin_required" });
      const result = await service.stopAuthSetup(); return json(res, result.status, result);
    }
    return json(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    return json(res, 500, { ok: false, error: "control_agent_error" });
  }
});
server.listen(config.port, config.host, () => console.log(`${config.appTitle} control listening on ${config.host}:${config.port}`));
