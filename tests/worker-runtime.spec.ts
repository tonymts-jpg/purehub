import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

async function waitForContinuedWorkerCycles(
  healthPort: number,
  phase5Calls: () => number,
  phase7Calls: () => number
) {
  const deadline = Date.now() + 24_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${healthPort}/health`);
      if (response.ok) {
        const body = await response.json();
        if (phase5Calls() >= 2 && phase7Calls() >= 2) return body;
      }
    } catch {
      // The worker listener may not have started yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Phase 5 and Phase 7 after hung account maintenance.");
}

test("account maintenance cannot block later Phase 5 and Phase 7 cycles when its request hangs", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Worker process behavior only needs one project.");
  test.setTimeout(30_000);
  let maintenanceCalls = 0;
  let phase5Calls = 0;
  let phase7Calls = 0;
  let tokenMismatch = false;
  const hangingMaintenanceResponses: import("node:http").ServerResponse[] = [];
  const mockServer = createServer((request, response) => {
    if (request.headers["x-worker-token"] !== "account-worker-test-token") {
      tokenMismatch = true;
    }
    if (request.url?.startsWith("/api/internal/account-maintenance/run")) {
      maintenanceCalls += 1;
      hangingMaintenanceResponses.push(response);
      return;
    }
    if (request.url?.startsWith("/api/internal/phase7/run")) {
      phase7Calls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        claimed: 0,
        completed: 0,
        failed: 0,
        channelMaterialization: { claimed: 0, completed: 0, failed: 0 },
        searchIndexing: { claimed: 0, completed: 0, failed: 0 }
      }));
      return;
    }
    phase5Calls += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  const mockPort = await listen(mockServer);
  const healthPort = await availablePort();
  const worker = spawn(process.execPath, ["scripts/worker.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKER_ACCESS_TOKEN: "account-worker-test-token",
      WORKER_HEALTH_PORT: String(healthPort),
      WEB_INTERNAL_URL: `http://127.0.0.1:${mockPort}`
    },
    stdio: "ignore"
  });

  try {
    const health = await waitForContinuedWorkerCycles(
      healthPort,
      () => phase5Calls,
      () => phase7Calls
    );
    expect(tokenMismatch).toBeFalsy();
    expect(maintenanceCalls).toBe(1);
    expect(phase5Calls).toBeGreaterThanOrEqual(2);
    expect(phase7Calls).toBeGreaterThanOrEqual(2);
    expect(health.tasks.accountMaintenance).toMatchObject({ status: "pending" });
    expect(health.tasks.phase5).toMatchObject({ status: "ok" });
    expect(health.tasks.phase7).toMatchObject({ status: "ok" });
  } finally {
    worker.kill();
    for (const response of hangingMaintenanceResponses) response.destroy();
    await Promise.race([
      once(worker, "exit"),
      new Promise((resolve) => setTimeout(resolve, 2_000))
    ]);
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  }
});
