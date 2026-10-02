import { Backoff } from "./backoff.mjs";
import { loadConfig, validateConfig } from "./config.mjs";
import { HealthState } from "./health-state.mjs";
import { startHealthServer } from "./health-server.mjs";
import { WorkerOutboxClient } from "./worker-client.mjs";
import { MockWorkerOutboxClient } from "./mock-worker-client.mjs";
import { DryRunZoomSender } from "./adapters/dry-run.mjs";
import { PlaywrightZoomSender } from "./adapters/playwright-zoom-sender.mjs";
import { ZoomSenderService } from "./sender.mjs";

const logger = console;
const config = loadConfig();
validateConfig(config);

const health = new HealthState({ dryRun: config.dryRun });
const backoff = new Backoff(config);
const workerClient = config.mockOutbox ? new MockWorkerOutboxClient(config) : new WorkerOutboxClient(config);
const zoomAdapter = config.dryRun
  ? new DryRunZoomSender({ logger })
  : new PlaywrightZoomSender(config, { logger });
const service = new ZoomSenderService({ workerClient, zoomAdapter, backoff, health, logger, zoomRecoveryAfterMs: config.zoomRecoveryAfterMs });
const healthServer = startHealthServer(config, health, logger);

async function shutdown(signal) {
  logger.info?.(`Zoom Sender received ${signal}; stopping`);
  await service.stop().catch(() => null);
  await new Promise((resolve) => healthServer.close(resolve));
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

service.runForever().catch(async (error) => {
  health.markError(error);
  logger.error?.("Zoom Sender fatal error:", error);
  await service.stop().catch(() => null);
  process.exit(1);
});
