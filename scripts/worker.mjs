import http from "node:http";

const port = Number(process.env.WORKER_HEALTH_PORT || 4001);
const appEnv = process.env.APP_ENV || process.env.NODE_ENV || "development";
const workerToken = process.env.WORKER_ACCESS_TOKEN;
const webBaseUrl = process.env.WEB_INTERNAL_URL || "http://web:3000";
const taskState = {
  lastRunAt: null,
  lastReconciliationAt: null,
  lastError: null,
  phase5: { lastRunAt: null, lastError: null },
  phase7: { lastRunAt: null, lastError: null }
};

async function runPhase5(action = "all") {
  if (!workerToken) throw new Error("WORKER_ACCESS_TOKEN is required.");
  const response = await fetch(`${webBaseUrl}/api/internal/phase5/run?action=${action}`, { method: "POST", headers: { "x-worker-token": workerToken } });
  if (!response.ok) throw new Error(`Phase 5 worker action ${action} failed with ${response.status}.`);
  taskState.phase5.lastRunAt = new Date().toISOString();
  taskState.phase5.lastError = null;
}

async function runPhase7() {
  if (!workerToken) throw new Error("WORKER_ACCESS_TOKEN is required.");
  const response = await fetch(`${webBaseUrl}/api/internal/phase7/run`, { method: "POST", headers: { "x-worker-token": workerToken } });
  if (!response.ok) throw new Error(`Phase 7 worker run failed with ${response.status}.`);
  taskState.phase7.lastRunAt = new Date().toISOString();
  taskState.phase7.lastError = null;
}

async function runSubsystem(name, operation) {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unknown ${name} worker error`;
    taskState[name].lastError = message;
    console.error(message);
  }
}

async function tick() {
  await Promise.all([
    runSubsystem("phase5", () => runPhase5("all")),
    runSubsystem("phase7", runPhase7)
  ]);
  const lastReconciliation = taskState.lastReconciliationAt ? new Date(taskState.lastReconciliationAt).getTime() : 0;
  if (Date.now() - lastReconciliation >= 24 * 60 * 60 * 1000) {
    await runSubsystem("phase5", async () => {
      await runPhase5("reconcile");
      taskState.lastReconciliationAt = new Date().toISOString();
    });
  }
  taskState.lastRunAt = new Date().toISOString();
  taskState.lastError = taskState.phase5.lastError ?? taskState.phase7.lastError;
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
