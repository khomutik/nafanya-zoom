import http from "node:http";

export function startHealthServer(config, health, logger = console) {
  const server = http.createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    const body = health.snapshot();
    response.writeHead(body.ok ? 200 : 503, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  });
  server.listen(config.healthPort, config.healthHost, () => {
    logger.info?.(`Zoom Sender health endpoint listening on ${config.healthHost}:${config.healthPort}`);
  });
  return server;
}
