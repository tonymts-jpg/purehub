const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000";

const checks = [
  { name: "home", path: "/" },
  { name: "explore", path: "/explore" },
  { name: "post-detail", path: "/post/post-1" },
  { name: "health", path: "/api/health", expectJsonStatus: "ok" },
  { name: "platform-rules", path: "/api/platform/rules" }
];

for (const check of checks) {
  const url = new URL(check.path, baseUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${check.name} failed: ${response.status} ${response.statusText} at ${url}`);
  }
  if (check.expectJsonStatus) {
    const body = await response.json();
    if (body.status !== check.expectJsonStatus) {
      throw new Error(`${check.name} expected status ${check.expectJsonStatus}, got ${body.status}`);
    }
  }
  console.log(`ok ${check.name} ${url}`);
}
