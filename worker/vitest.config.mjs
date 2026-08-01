import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ZOOM_PANEL_TOKEN: "panel-test-secret",
          ZOOM_ONLY_SECRET: "sender-test-secret"
        }
      }
    })
  ],
  test: {
    testTimeout: 15_000
  }
});
