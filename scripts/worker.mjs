import http from "node:http";

const port = Number(process.env.WORKER_HEALTH_PORT || 4001);
const appEnv = process.env.APP_ENV || process.env.NODE_ENV || "development";
const workerToken = process.env.WORKER_ACCESS_TOKEN;
const webBaseUrl = process.env.WEB_INTERNAL_URL || "http://web:3000";
const taskState = { lastRunAt: null, lastReconciliationAt: null, lastError: null };

async function run(action = "all") {
  if (!workerToken) throw new Error("WORKER_ACCESS_TOKEN is required.");
  const response = await fetch(`${webBaseUrl}/api/internal/phase5/run?action=${action}`, { method: "POST", headers: { "x-worker-token": workerToken } });
  if (!response.ok) throw new Error(`Phase 5 worker action ${action} failed with ${response.status}.`);
  taskState.lastRunAt = new Date().toISOString();
  taskState.lastError = null;
}

async function tick() {
  try {
    await run("all");
    const lastReconciliation = taskState.lastReconciliationAt ? new Date(taskState.lastReconciliationAt).getTime() : 0;
    if (Date.now() - lastReconciliation >= 24 * 60 * 60 * 1000) {
      await run("reconcile");
      taskState.lastReconciliationAt = new Date().toISOString();
    }
  } catch (error) {
    taskState.lastError = error instanceof Error ? error.message : "Unknown worker error";
    console.error(taskState.lastError);
  }
}

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      status: "ok",
      service: "purehub-worker",
      environment: appEnv,
      queues: ["media", "payments", "settlement", "reconciliation", "analytics", "moderation"],
      tasks: taskState,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: "not_found" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`PureHub worker health server listening on ${port}`);
  setTimeout(() => void tick(), 5000);
  setInterval(() => void tick(), 15000);
});
