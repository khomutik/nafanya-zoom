import { buildPanelHtml } from "../src/panel.mjs";

const html = buildPanelHtml();
const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1];
if (!script) throw new Error("Panel script was not found.");

// Parse only. The browser code is not executed in Node.
new Function(script);
console.log(`Panel script syntax is valid (${html.length} bytes).`);

