import { expect, test } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForWorkerHealth(port: number) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        const body = await response.json();
        if (body.tasks?.searchIndexing?.lastRunAt) return body;
      }
    } catch {
      // The worker health listener may not have started yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the Phase 7 worker health update.");
}

function runSmokeValidator(kind: string, input: string) {
  return spawnSync(process.execPath, ["scripts/smoke-test.mjs", "validate-json", kind], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, PUREHUB_COMMIT_SHA: "" },
    input
  });
}

function bashExecutable() {
  return process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
}

function shellPath(path: string) {
  return process.platform === "win32"
    ? path.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll("\\", "/")
    : path;
}

async function writeExecutable(path: string, contents: string) {
  await writeFile(path, contents, "utf8");
  await chmod(path, 0o755);
}

async function runDeployHarness(environment: string) {
  const directory = await mkdtemp(join(tmpdir(), "purehub-deploy-"));
  const fakeBin = join(directory, "bin");
  const commandLog = join(directory, "docker-commands.log");
  await mkdir(fakeBin);
  await writeFile(join(directory, ".env.staging"), environment, "utf8");
  await writeExecutable(
    join(fakeBin, "docker"),
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$COMMAND_LOG\"\nexit 0\n"
  );
  await writeExecutable(
    join(fakeBin, "git"),
    "#!/usr/bin/env bash\nprintf '%040d\\n' 0 | tr '0' 'a'\n"
  );
  await writeExecutable(
    join(fakeBin, "curl"),
    "#!/usr/bin/env bash\nfor arg in \"$@\"; do\n  if [[ \"$arg\" == *'%{http_code}'* ]]; then printf '401'; fi\ndone\nexit 0\n"
  );
  await writeExecutable(join(fakeBin, "node"), "#!/usr/bin/env bash\nexit 0\n");

  try {
    const result = spawnSync(
      bashExecutable(),
      [
        "-c",
        'PATH="$1:$PATH" "$2" staging',
        "_",
        shellPath(fakeBin),
        shellPath(resolve("scripts/deploy.sh"))
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          COMMAND_LOG: shellPath(commandLog)
        }
      }
    );
    const commands = await readFile(commandLog, "utf8");
    return { ...result, commands };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("healthcheck uses port 80 when HTTP_PORT is absent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "purehub-healthcheck-"));
  const fakeBin = join(directory, "bin");
  await mkdir(fakeBin);
  await writeFile(join(directory, ".env.staging"), "APP_ENV=staging\n", "utf8");
  await writeExecutable(join(fakeBin, "docker"), "#!/usr/bin/env bash\nexit 0\n");
  await writeExecutable(join(fakeBin, "curl"), "#!/usr/bin/env bash\nexit 0\n");

  try {
    const result = spawnSync(
      bashExecutable(),
      [
        "-c",
        'PATH="$1:$PATH" "$2" staging',
        "_",
        shellPath(fakeBin),
        shellPath(resolve("scripts/healthcheck.sh"))
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: process.env
      }
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("PureHub staging healthcheck passed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deploy refreshes nginx after recreating upstream services", async () => {
  const result = await runDeployHarness(
    "HTTP_PORT=80\nADMIN_ACCESS_TOKEN=test-admin-token\n",
  );

  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const upIndex = result.commands.indexOf("compose --env-file .env.staging up -d --remove-orphans");
  const restartIndex = result.commands.indexOf("compose --env-file .env.staging restart nginx");
  expect(upIndex).toBeGreaterThanOrEqual(0);
  expect(restartIndex).toBeGreaterThan(upIndex);
});

test("deploy uses port 80 when HTTP_PORT is absent", async () => {
  const result = await runDeployHarness("ADMIN_ACCESS_TOKEN=test-admin-token\n");

  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stdout).toContain("Deployment complete");
});

test("health endpoint exposes server dependency status", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.status).toBe("ok");
  expect(body.phase).toBe("phase-7");
  expect(body.commit).toMatch(/^(unknown|[0-9a-f]{40})$/);
  expect(body.locales).toEqual(["zh-CN", "zh-TW", "en", "ja"]);
  expect(body.paymentProviders).toContain("usdt");
  expect(body.capabilities).toMatchObject({
    databaseSessions: true,
    credentialAuth: true,
    socialInteractions: true,
    notifications: true,
    channels: true,
    channelAcl: true,
    postgresSearch: true
  });
  expect(body.dependencies.database.status).toMatch(/ok|skipped/);
  expect(body.dependencies.redis.status).toMatch(/ok|skipped/);
  expect(body.dependencies.objectStorage.status).toMatch(/ok|skipped/);
});

test("phase 7 public smoke surfaces and identity boundary are ready", async ({ request }) => {
  const healthResponse = await request.get("/api/health");
  const healthBody = await healthResponse.json();
  test.skip(
    healthBody.dependencies?.database?.status !== "ok",
    "Phase 7 public smoke surfaces require the live PostgreSQL staging gate."
  );

  const channelsResponse = await request.get("/api/channels");
  expect(channelsResponse.ok(), await channelsResponse.text()).toBeTruthy();
  const channelsBody = await channelsResponse.json();
  expect(Array.isArray(channelsBody.channels)).toBeTruthy();

  const searchResponse = await request.get("/api/search?q=yuki&type=creator");
  expect(searchResponse.ok(), await searchResponse.text()).toBeTruthy();
  const searchBody = await searchResponse.json();
  expect(Array.isArray(searchBody.results)).toBeTruthy();

  const mutationResponse = await request.post("/api/dashboard/channels", {
    data: {
      name: "Unauthenticated smoke mutation",
      slug: "unauthenticated-smoke-mutation",
      visibility: "public"
    }
  });
  expect(mutationResponse.status(), await mutationResponse.text()).toBe(401);
});

test("deployment defaults and both smoke runners enforce the phase 7 contract", async () => {
  const [environment, compose, deploy, health, nodeSmoke, shellSmoke, worker] = await Promise.all([
    readFile(".env.example", "utf8"),
    readFile("docker-compose.yml", "utf8"),
    readFile("scripts/deploy.sh", "utf8"),
    readFile("app/api/health/route.ts", "utf8"),
    readFile("scripts/smoke-test.mjs", "utf8"),
    readFile("scripts/smoke-test.sh", "utf8"),
    readFile("scripts/worker.mjs", "utf8")
  ]);

  expect(environment).toMatch(/^PUREHUB_PHASE=phase-7$/m);
  expect(compose.match(/PUREHUB_PHASE: \$\{PUREHUB_PHASE:-phase-7\}/g)).toHaveLength(2);
  expect(compose.match(/PUREHUB_COMMIT_SHA: \$\{PUREHUB_COMMIT_SHA:-unknown\}/g)).toHaveLength(2);
  expect(deploy).toContain("git rev-parse HEAD");
  expect(deploy).toContain("export PUREHUB_COMMIT_SHA");
  expect(health).toContain("PUREHUB_COMMIT_SHA");

  for (const smoke of [nodeSmoke, shellSmoke]) {
    expect(smoke).toContain("/api/channels");
    expect(smoke).toContain("/api/search?q=yuki&type=creator");
    expect(smoke).toContain("/api/dashboard/channels");
  }
  expect(nodeSmoke).toContain('"phase-7"');
  expect(nodeSmoke).toContain("postgresSearch");
  expect(shellSmoke).toContain("smoke-test.mjs");
  expect(shellSmoke).toContain("validate-json");
  expect(shellSmoke).not.toContain("grep");

  expect(worker).toContain('"channelMaterialization"');
  expect(worker).toContain('"searchIndexing"');
});

test("phase 7 smoke validators require the known seeded channel, creator, and runtime commit", () => {
  const commit = "a".repeat(40);
  const valid = [
    runSmokeValidator("health", JSON.stringify({
      status: "ok",
      phase: "phase-7",
      commit,
      capabilities: { channels: true, channelAcl: true, postgresSearch: true }
    })),
    runSmokeValidator("channels", JSON.stringify({
      channels: [{ slug: "purehub-official", name: "PureHub Official" }]
    })),
    runSmokeValidator("creator-search", JSON.stringify({
      results: [{ entityType: "creator", entityId: "c1", title: "林夕 Yuki" }]
    }))
  ];
  for (const result of valid) {
    expect(result.status, result.stderr).toBe(0);
  }

  const invalid = [
    runSmokeValidator("channels", JSON.stringify({ channels: [] })),
    runSmokeValidator("channels", JSON.stringify({
      channels: [{ slug: "wrong", name: "Wrong" }]
    })),
    runSmokeValidator("creator-search", JSON.stringify({
      results: [{ entityType: "channel", entityId: "channel-yuki-studio", title: "Yuki Studio" }]
    })),
    runSmokeValidator("creator-search", JSON.stringify({
      results: [{ entityType: "creator", entityId: "c1", title: "Wrong" }]
    })),
    runSmokeValidator("health", "{")
  ];
  for (const result of invalid) {
    expect(result.status).not.toBe(0);
  }
});

test("phase 7 worker reports independent sanitized materialization and search counters", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Worker process behavior only needs one project.");
  test.setTimeout(20_000);
  const mockServer = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(
      request.url?.startsWith("/api/internal/phase7/run")
        ? request.headers["x-worker-token"] === "malformed-worker-test-token"
          ? { claimed: "not-a-number" }
          : {
            claimed: 3,
            completed: 2,
            failed: 1,
            channelMaterialization: { claimed: 1, completed: 1, failed: 0 },
            searchIndexing: { claimed: 2, completed: 1, failed: 1 }
          }
        : {}
    ));
  });
  const mockPort = await listen(mockServer);
  const healthPort = await availablePort();
  const malformedHealthPort = await availablePort();
  const worker = spawn(process.execPath, ["scripts/worker.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKER_ACCESS_TOKEN: "purehub-worker-test-token",
      WORKER_HEALTH_PORT: String(healthPort),
      WEB_INTERNAL_URL: `http://127.0.0.1:${mockPort}`,
      PUREHUB_COMMIT_SHA: "b".repeat(40)
    },
    stdio: "ignore"
  });
  const malformedWorker = spawn(process.execPath, ["scripts/worker.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKER_ACCESS_TOKEN: "malformed-worker-test-token",
      WORKER_HEALTH_PORT: String(malformedHealthPort),
      WEB_INTERNAL_URL: `http://127.0.0.1:${mockPort}`
    },
    stdio: "ignore"
  });

  try {
    const [health, malformedHealth] = await Promise.all([
      waitForWorkerHealth(healthPort),
      waitForWorkerHealth(malformedHealthPort)
    ]);
    expect(health.commit).toBe("b".repeat(40));
    expect(health.tasks.channelMaterialization).toMatchObject({
      status: "ok",
      claimed: 1,
      completed: 1,
      failed: 0
    });
    expect(health.tasks.searchIndexing).toMatchObject({
      status: "error",
      claimed: 2,
      completed: 1,
      failed: 1
    });
    expect(JSON.stringify(health)).not.toContain("lastError");
    expect(malformedHealth.tasks.channelMaterialization).toMatchObject({
      status: "error",
      claimed: 0,
      completed: 0,
      failed: 0
    });
    expect(malformedHealth.tasks.searchIndexing.status).toBe("error");
    expect(JSON.stringify(malformedHealth)).not.toContain("not-a-number");
    expect(JSON.stringify(malformedHealth)).not.toContain("lastError");
  } finally {
    worker.kill();
    malformedWorker.kill();
    await Promise.race([
      Promise.all([once(worker, "exit"), once(malformedWorker, "exit")]),
      new Promise((resolve) => setTimeout(resolve, 2_000))
    ]);
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  }
});

test("platform rules expose formal phase constraints", async ({ request }) => {
  const response = await request.get("/api/platform/rules");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.contentRules.shortVideoMaxSeconds).toBe(60);
  expect(body.contentRules.longVideoMaxSeconds).toBe(300);
  expect(body.usdtDefaults.networks).toEqual(["TRC20", "ERC20"]);
  expect(body.platformFeeRules).toEqual({ minFeeBps: 0, maxFeeBps: 5000, defaultFeeBps: 1000 });
  expect(body.settlementRules).toEqual({ defaultHoldDays: 7, minHoldDays: 0, maxHoldDays: 90 });
  expect(body.identity).toEqual({ provider: "better-auth", sessionStore: "database", credentials: true });
  expect(body.social).toEqual({ follows: true, likes: true, bookmarks: true, comments: true, notifications: true });
  expect(body.channels).toEqual({
    kinds: ["official", "creator"],
    visibilities: ["public", "private"],
    discoverability: ["discoverable", "hidden"],
    roles: ["owner", "editor", "member"],
    creatorLevelQuotas: { "level-1": 1, "level-2": 3, "level-3": 5 }
  });
  expect(Object.keys(body.paymentProviders)).toEqual([
    "stripe",
    "paypal",
    "card",
    "alipay_intl",
    "wechatpay_intl",
    "usdt"
  ]);
});
