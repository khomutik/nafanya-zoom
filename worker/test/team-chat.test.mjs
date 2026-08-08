import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, normalizeMeetingId, teamChatTestEnabled } from "../src/team-chat-state.mjs";

describe("Team Chat laboratory helpers", () => {
  it("encrypts OAuth tokens at rest", async () => {
    const token = { access_token: "access-secret", refresh_token: "refresh-secret", expires_at: 123 };
    const encrypted = await encryptToken(token, "test-key");
    expect(JSON.stringify(encrypted)).not.toContain("access-secret");
    expect(await decryptToken(encrypted, "test-key")).toEqual(token);
  });

  it("normalizes and strictly allowlists test meetings", () => {
    const env = { ZOOM_TEAM_CHAT_TEST_ENABLED: "true", ZOOM_TEAM_CHAT_TEST_MEETING_IDS: "TEST-999" };
    expect(normalizeMeetingId(" TEST /-999 ")).toBe("TEST-999");
    expect(teamChatTestEnabled(env, "TEST-999")).toBe(true);
    expect(teamChatTestEnabled(env, "PRODUCTION-1")).toBe(false);
  });
});
