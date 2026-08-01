process.env.ZOOM_SENDER_DRY_RUN = "true";
process.env.ZOOM_SENDER_MOCK_OUTBOX = process.env.ZOOM_SENDER_MOCK_OUTBOX || "true";

await import("./main.mjs");
