import { defineConfig, devices } from "@playwright/test";

const deployedBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = deployedBaseURL ?? "http://localhost:3001";
const workerAccessToken = process.env.WORKER_ACCESS_TOKEN ?? "purehub-local-playwright-worker-token";
process.env.WORKER_ACCESS_TOKEN = workerAccessToken;

export default defineConfig({
  testDir:"./tests",
  timeout: deployedBaseURL ? 120_000 : 30_000,
  expect:{timeout:15_000},
  workers:1,
  use:{baseURL,trace:"on-first-retry"},
  webServer:deployedBaseURL ? undefined : {
    command:"npm run dev -- -p 3001",
    url:baseURL,
    reuseExistingServer:true,
    env:{NEXT_PUBLIC_DEMO_MODE:"true",BETTER_AUTH_SECRET:"purehub-local-playwright-secret-at-least-32-characters",PUREHUB_PHASE:"phase-7",WORKER_ACCESS_TOKEN:workerAccessToken}
  },
  projects:[
    {name:"desktop",use:{...devices["Desktop Chrome"]}},
    {name:"mobile",use:{...devices["Pixel 5"]}}
  ]
});
