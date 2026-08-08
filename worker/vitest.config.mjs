import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ZOOM_PANEL_TOKEN: "panel-test-secret",
          ZOOM_ONLY_SECRET: "sender-test-secret",
          ZOOM_TEAM_CHAT_TEST_ENABLED: "true",
          ZOOM_TEAM_CHAT_TEST_MEETING_IDS: "TEST-999",
          ZOOM_TEAM_CHAT_TOKEN_ENCRYPTION_KEY: "test-only-encryption-key"
        }
      }
    })
  ],
  test: {
    testTimeout: 15_000
  }
});
