const token = process.env.ZOOM_CONTROL_TOKEN || "local-control-token";
const port = process.env.ZOOM_CONTROL_PORT || "3098";
const response = await fetch(`http://127.0.0.1:${port}/api/stop`, { method: "POST", headers: { "x-nafanya-control-token": token } }).catch(() => null);
if (!response) { console.log("Локальный control-agent не запущен."); process.exit(0); }
console.log(await response.text());
