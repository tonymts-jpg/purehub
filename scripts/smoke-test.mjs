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

const meResponse = await fetch(new URL("/api/me", baseUrl));
if (meResponse.status !== 401) throw new Error(`identity boundary expected 401, got ${meResponse.status}`);
console.log("ok identity-boundary /api/me");

const adminToken = process.env.SMOKE_ADMIN_TOKEN || process.env.ADMIN_ACCESS_TOKEN;
if (adminToken) {
  const url = new URL("/api/admin/finance/fee-configs", baseUrl);
  const response = await fetch(url, {
    headers: {
      "x-admin-token": adminToken
    }
  });
  if (!response.ok) {
    throw new Error(`finance-fee-configs failed: ${response.status} ${response.statusText} at ${url}`);
  }
  const body = await response.json();
  if (!Array.isArray(body.configs)) {
    throw new Error("finance-fee-configs expected configs array");
  }
  console.log(`ok finance-fee-configs ${url}`);
  for (const path of ["/api/admin/finance/settlement-configs", "/api/admin/finance/reconciliation"]) {
    const phase5Url = new URL(path, baseUrl);
    const phase5Response = await fetch(phase5Url, { headers: { "x-admin-token": adminToken } });
    if (!phase5Response.ok) throw new Error(`phase5 finance check failed: ${phase5Response.status} at ${phase5Url}`);
    console.log(`ok phase5-finance ${phase5Url}`);
  }
} else {
  console.log("skip finance-fee-configs: SMOKE_ADMIN_TOKEN or ADMIN_ACCESS_TOKEN not configured");
}
