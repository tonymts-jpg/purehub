import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir:"./tests",
  use:{baseURL:"http://localhost:3001",trace:"on-first-retry"},
  webServer:{command:"npm run dev -- -p 3001",url:"http://localhost:3001",reuseExistingServer:true},
  projects:[
    {name:"desktop",use:{...devices["Desktop Chrome"]}},
    {name:"mobile",use:{...devices["Pixel 5"]}}
  ]
});
