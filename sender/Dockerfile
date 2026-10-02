FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl novnc websockify xvfb xauth x11-utils x11vnc \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev \
  && npx playwright install --with-deps chromium \
  && npm cache clean --force

COPY . .

RUN mkdir -p /app/profile /tmp/.X11-unix \
  && chmod 1777 /tmp/.X11-unix \
  && chown -R node:node /app /ms-playwright

USER node

EXPOSE 3097

CMD ["sh", "-lc", "if [ \"${HEADLESS:-${ZOOM_SENDER_HEADLESS:-true}}\" = \"false\" ] || [ \"${ZOOM_AUTH_VIEW_ENABLED:-false}\" = \"true\" ]; then rm -f /tmp/.X99-lock /tmp/.X11-unix/X99; Xvfb :99 -screen 0 1280x720x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & export DISPLAY=:99; for i in $(seq 1 30); do xdpyinfo -display :99 >/dev/null 2>&1 && break; sleep 0.2; done; fi; if [ \"${ZOOM_AUTH_SETUP:-false}\" = \"true\" ]; then if [ \"${ZOOM_AUTH_VIEW_ENABLED:-false}\" = \"true\" ]; then x11vnc -display :99 -forever -shared -localhost -nopw -rfbport 5900 -o /tmp/x11vnc.log >/dev/null 2>&1 & websockify --web=/usr/share/novnc 0.0.0.0:6080 localhost:5900 >/tmp/websockify.log 2>&1 & fi; exec node src/auth-setup.mjs; else exec node src/main.mjs; fi"]
