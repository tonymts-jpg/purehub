import http from "node:http";

const port = Number(process.env.WORKER_HEALTH_PORT || 4001);
const appEnv = process.env.APP_ENV || process.env.NODE_ENV || "development";

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      status: "ok",
      service: "purehub-worker",
      environment: appEnv,
      queues: ["media", "payments", "analytics", "moderation"],
      timestamp: new Date().toISOString()
    }));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: "not_found" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`PureHub worker health server listening on ${port}`);
});
