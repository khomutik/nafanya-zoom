# Experimental Team Chat message replacement

This optional laboratory checks whether a message created from a Zoom App can later be updated or deleted through the official Zoom Team Chat API. Keep it disabled for the production meeting until the behaviour has been verified with internal users, external Zoom accounts and guests.

## Isolation rules

- Use a separate recurring test meeting (`No Fixed Time`).
- Use a separate Zoom Marketplace app.
- Put only the test meeting ID in `ZOOM_TEAM_CHAT_TEST_MEETING_IDS`.
- The Worker stores that meeting in its own Durable Object named from the meeting ID. It does not import or write the production queue.
- OAuth tokens and message IDs live in `ZoomTeamChatState`, separately from the meeting board and timer.

## Zoom Marketplace settings

Enable the Zoom App surface for Meetings and Chat and add these Zoom Apps SDK APIs:

- `getSupportedJsApis`
- `appPopout`
- `setDynamicIndicator`
- `removeDynamicIndicator`
- `extendDynamicIndicator`
- `sendMessageToChat`

Add the least-privilege OAuth scopes for sending, updating and deleting the app user's own Team Chat messages. Zoom can rename scopes; use the current `team_chat:*:user_message` variants shown by Marketplace.

Set the OAuth redirect URL to:

```text
https://YOUR-WORKER/zoom-only/team-chat/oauth/callback
```

## Worker configuration

Set non-secret variables in `worker/wrangler.jsonc` or the Cloudflare dashboard:

```text
ZOOM_TEAM_CHAT_TEST_ENABLED=true
ZOOM_TEAM_CHAT_TEST_MEETING_IDS=YOUR_TEST_MEETING_ID
ZOOM_TEAM_CHAT_CLIENT_ID=YOUR_TEST_APP_CLIENT_ID
ZOOM_TEAM_CHAT_REDIRECT_URI=https://YOUR-WORKER/zoom-only/team-chat/oauth/callback
```

Store these as Worker secrets:

```bash
npx wrangler secret put ZOOM_TEAM_CHAT_CLIENT_SECRET
npx wrangler secret put ZOOM_TEAM_CHAT_TOKEN_ENCRYPTION_KEY
```

The encryption key should be a newly generated random value. Do not reuse the panel token or sender secret.

Add the test app secret and allowlist to `sender/.env` so the control-agent can validate the second app context:

```text
ZOOM_TEAM_CHAT_TEST_APP_CLIENT_SECRET=...
ZOOM_TEAM_CHAT_TEST_ENABLED=true
ZOOM_TEAM_CHAT_TEST_MEETING_IDS=...
```

## Test sequence

1. Open the dedicated test meeting and the test Zoom App on desktop.
2. Start OAuth through `/zoom-only/team-chat/oauth/start` (the request must carry the panel token and test meeting ID; the control-agent does this for the app).
3. Add one queue entry. The first message is sent by `sendMessageToChat`; the returned `channelId` and `messageId` are saved.
4. Change the queue. The Worker updates the same message through REST. Extra parts are created; obsolete parts are deleted.
5. Compare the meeting chat and Team Chat history on desktop, Android, an external account and a guest.

If the first SDK call does not return both IDs, the experiment stops safely. It does not fall back to DOM automation and it does not touch the production outbox.
