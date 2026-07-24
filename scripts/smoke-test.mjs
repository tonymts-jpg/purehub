const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000";

const checks = [
  { name: "home", path: "/" },
  { name: "explore", path: "/explore" },
  { name: "post-detail", path: "/post/post-1" },
  { name: "platform-rules", path: "/api/platform/rules" }
];

for (const check of checks) {
  const url = new URL(check.path, baseUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${check.name} failed: ${response.status} ${response.statusText} at ${url}`);
  }
  console.log(`ok ${check.name} ${url}`);
}

async function requireJson(name, path, validate) {
  const url = new URL(path, baseUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${name} failed: ${response.status} ${response.statusText} at ${url}`);
  }
  const body = await response.json();
  validate(body);
  console.log(`ok ${name} ${url}`);
}

await requireJson("health", "/api/health", (body) => {
  if (body.status !== "ok") throw new Error(`health expected status ok, got ${body.status}`);
  if (body.phase !== "phase-7") throw new Error(`health expected phase-7, got ${body.phase}`);
  for (const capability of ["channels", "channelAcl", "postgresSearch"]) {
    if (body.capabilities?.[capability] !== true) {
      throw new Error(`health expected capability ${capability}`);
    }
  }
});

await requireJson("channels", "/api/channels", (body) => {
  if (!Array.isArray(body.channels)) throw new Error("channels expected channels array");
});

await requireJson("creator-search", "/api/search?q=yuki&type=creator", (body) => {
  if (!Array.isArray(body.results)) throw new Error("creator-search expected results array");
});

const meResponse = await fetch(new URL("/api/me", baseUrl));
if (meResponse.status !== 401) throw new Error(`identity boundary expected 401, got ${meResponse.status}`);
console.log("ok identity-boundary /api/me");

const channelMutationResponse = await fetch(new URL("/api/dashboard/channels", baseUrl), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}"
});
if (channelMutationResponse.status !== 401) {
  throw new Error(`channel mutation identity boundary expected 401, got ${channelMutationResponse.status}`);
}
console.log("ok channel-mutation-identity-boundary /api/dashboard/channels");

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
