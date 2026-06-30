import { defineConfig, devices } from "@playwright/test";

const deployedBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = deployedBaseURL ?? "http://localhost:3001";

export default defineConfig({
  testDir:"./tests",
  use:{baseURL,trace:"on-first-retry"},
  webServer:deployedBaseURL ? undefined : {command:"npm run dev -- -p 3001",url:baseURL,reuseExistingServer:true},
  projects:[
    {name:"desktop",use:{...devices["Desktop Chrome"]}},
    {name:"mobile",use:{...devices["Pixel 5"]}}
  ]
});
