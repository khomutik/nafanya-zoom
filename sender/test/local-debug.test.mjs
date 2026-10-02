import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { LocalProcessOps } from "../control-agent/local-ops.mjs";

test("local process ops starts the real sender with dry-run disabled", async () => {
  let options;
  const child = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => { child.killed = true; child.exitCode = 0; child.emit("exit", 0); };
  const ops = new LocalProcessOps({ projectDir: "C:/sender", profileDir: "C:/profile" }, { spawnImpl: (_file, _args, value) => { options = value; return child; } });
  await ops.startSender();
  assert.equal(options.env.ZOOM_SENDER_DRY_RUN, "false");
  assert.equal(options.env.ZOOM_SENDER_MOCK_OUTBOX, "false");
  assert.equal(await ops.isSenderRunning(), true);
  await ops.stopSender();
  assert.equal(await ops.isSenderRunning(), false);
});

test("local debug configuration has isolation guards and no production URL", async () => {
  const script = await readFile(path.resolve(import.meta.dirname, "..", "scripts", "debug-all.mjs"), "utf8");
  assert.match(script, /ZOOM_CONTROL_LOCAL_MODE/iu);
  assert.match(script, /pochti-normalnye\\\.workers\\\.dev/iu);
  assert.match(script, /5487249245/iu);
  assert.match(script, /ZOOM_SENDER_MOCK_OUTBOX: "false"/u);
});
