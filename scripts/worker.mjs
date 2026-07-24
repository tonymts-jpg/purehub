import http from "node:http";

const port = Number(process.env.WORKER_HEALTH_PORT || 4001);
const appEnv = process.env.APP_ENV || process.env.NODE_ENV || "development";
const workerToken = process.env.WORKER_ACCESS_TOKEN;
const webBaseUrl = process.env.WEB_INTERNAL_URL || "http://web:3000";
const runtimeCommit = /^[0-9a-f]{40}$/.test(process.env.PUREHUB_COMMIT_SHA ?? "")
  ? process.env.PUREHUB_COMMIT_SHA
  : "unknown";
const taskState = {
  lastRunAt: null,
  lastReconciliationAt: null,
  lastError: null,
  phase5: { lastRunAt: null, lastError: null },
  phase7: { lastRunAt: null, lastError: null },
  channelMaterialization: { lastRunAt: null, lastError: null, claimed: 0, completed: 0, failed: 0 },
  searchIndexing: { lastRunAt: null, lastError: null, claimed: 0, completed: 0, failed: 0 }
};

function subsystemHealth(state) {
  return {
    lastRunAt: state.lastRunAt,
    status: state.lastError ? "error" : state.lastRunAt ? "ok" : "pending"
  };
}

function workerTaskHealth() {
  const phase7TaskHealth = (state) => ({
    ...subsystemHealth(state),
    claimed: state.claimed,
    completed: state.completed,
    failed: state.failed
  });
  return {
    lastRunAt: taskState.lastRunAt,
    lastReconciliationAt: taskState.lastReconciliationAt,
    status: taskState.lastError ? "error" : taskState.lastRunAt ? "ok" : "pending",
    phase5: subsystemHealth(taskState.phase5),
    phase7: subsystemHealth(taskState.phase7),
    channelMaterialization: phase7TaskHealth(taskState.channelMaterialization),
    searchIndexing: phase7TaskHealth(taskState.searchIndexing)
  };
}

function parseCounter(value, label) {
  if (!value || typeof value !== "object") throw new Error(`Phase 7 worker ${label} result is invalid.`);
  const counter = {};
  for (const field of ["claimed", "completed", "failed"]) {
    if (!Number.isInteger(value[field]) || value[field] < 0) {
      throw new Error(`Phase 7 worker ${label} result is invalid.`);
    }
    counter[field] = value[field];
  }
  if (counter.completed + counter.failed > counter.claimed) {
    throw new Error(`Phase 7 worker ${label} result is invalid.`);
  }
  return counter;
}

function parsePhase7RunResult(value) {
  const aggregate = parseCounter(value, "aggregate");
  const channelMaterialization = parseCounter(value.channelMaterialization, "channel materialization");
  const searchIndexing = parseCounter(value.searchIndexing, "search indexing");
  if (
    channelMaterialization.claimed + searchIndexing.claimed !== aggregate.claimed
    || channelMaterialization.completed + searchIndexing.completed !== aggregate.completed
    || channelMaterialization.failed + searchIndexing.failed !== aggregate.failed
  ) {
    throw new Error("Phase 7 worker result counters are inconsistent.");
  }
  return { ...aggregate, channelMaterialization, searchIndexing };
}

async function runPhase5(action = "all") {
  if (!workerToken) throw new Error("WORKER_ACCESS_TOKEN is required.");
  const response = await fetch(`${webBaseUrl}/api/internal/phase5/run?action=${action}`, { method: "POST", headers: { "x-worker-token": workerToken } });
  if (!response.ok) throw new Error(`Phase 5 worker action ${action} failed with ${response.status}.`);
}

async function runPhase7() {
  if (!workerToken) throw new Error("WORKER_ACCESS_TOKEN is required.");
  const response = await fetch(`${webBaseUrl}/api/internal/phase7/run`, { method: "POST", headers: { "x-worker-token": workerToken } });
  if (!response.ok) throw new Error(`Phase 7 worker run failed with ${response.status}.`);
  return parsePhase7RunResult(await response.json());
}

function updatePhase7Task(name, counter, lastRunAt) {
  const failed = counter.failed > 0;
  taskState[name] = {
    lastRunAt,
    lastError: failed ? `Phase 7 ${name} reported failed jobs.` : null,
    ...counter
  };
  return !failed;
}

async function runPhase7Subsystem() {
  const lastRunAt = new Date().toISOString();
  try {
    const result = await runPhase7();
    const materializationSucceeded = updatePhase7Task(
      "channelMaterialization",
      result.channelMaterialization,
      lastRunAt
    );
    const searchSucceeded = updatePhase7Task(
      "searchIndexing",
      result.searchIndexing,
      lastRunAt
    );
    taskState.phase7.lastRunAt = lastRunAt;
    taskState.phase7.lastError = materializationSucceeded && searchSucceeded
      ? null
      : "Phase 7 worker reported failed jobs.";
    if (taskState.phase7.lastError) console.error(taskState.phase7.lastError);
    return materializationSucceeded && searchSucceeded;
  } catch {
    const message = "Phase 7 worker run failed.";
    taskState.phase7 = { lastRunAt, lastError: message };
    taskState.channelMaterialization.lastRunAt = lastRunAt;
    taskState.channelMaterialization.lastError = message;
    taskState.searchIndexing.lastRunAt = lastRunAt;
    taskState.searchIndexing.lastError = message;
    console.error(message);
    return false;
  }
}

async function runSubsystem(name, operation) {
  try {
    await operation();
    taskState[name].lastRunAt = new Date().toISOString();
    taskState[name].lastError = null;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unknown ${name} worker error`;
    taskState[name].lastError = message;
    console.error(message);
    return false;
  }
}

async function tick() {
  const [phase5Succeeded] = await Promise.all([
    runSubsystem("phase5", () => runPhase5("all")),
    runPhase7Subsystem()
  ]);
  const lastReconciliation = taskState.lastReconciliationAt ? new Date(taskState.lastReconciliationAt).getTime() : 0;
  if (Date.now() - lastReconciliation >= 24 * 60 * 60 * 1000) {
    try {
      await runPhase5("reconcile");
      taskState.lastReconciliationAt = new Date().toISOString();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Phase 5 reconciliation error";
      if (phase5Succeeded) taskState.phase5.lastError = message;
      console.error(message);
    }
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
      commit: runtimeCommit,
      environment: appEnv,
      queues: [
        "media",
        "payments",
        "settlement",
        "reconciliation",
        "analytics",
        "moderation",
        "channelMaterialization",
        "searchIndexing"
      ],
      tasks: workerTaskHealth(),
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
