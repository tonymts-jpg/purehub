import { defineConfig, devices } from "@playwright/test";

const deployedBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = deployedBaseURL ?? "http://localhost:3001";

export default defineConfig({
  testDir:"./tests",
  workers: 2,
  use:{baseURL,trace:"on-first-retry"},
  webServer:deployedBaseURL ? undefined : {
    command:"npm run dev -- -p 3001",
    url:baseURL,
    reuseExistingServer:true,
    env:{NEXT_PUBLIC_DEMO_MODE:"true",BETTER_AUTH_SECRET:"purehub-local-playwright-secret-at-least-32-characters"}
  },
  projects:[
    {name:"desktop",use:{...devices["Desktop Chrome"]}},
    {name:"mobile",use:{...devices["Pixel 5"]}}
  ]
});
