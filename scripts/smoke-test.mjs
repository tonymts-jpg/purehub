import { pathToFileURL } from "node:url";

const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const expectedCommit = /^[0-9a-f]{40}$/.test(process.env.PUREHUB_COMMIT_SHA ?? "")
  ? process.env.PUREHUB_COMMIT_SHA
  : null;

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} expected a JSON object`);
  }
  return value;
}

export function validateHealth(value) {
  const body = requireObject(value, "health");
  if (body.status !== "ok") throw new Error(`health expected status ok, got ${body.status}`);
  if (body.phase !== "phase-7") throw new Error(`health expected phase-7, got ${body.phase}`);
  if (!/^[0-9a-f]{40}$/.test(body.commit ?? "")) {
    throw new Error("health expected an exact 40-character runtime commit");
  }
  if (expectedCommit && body.commit !== expectedCommit) {
    throw new Error("health runtime commit does not match the deployed commit");
  }
  for (const capability of ["channels", "channelAcl", "postgresSearch"]) {
    if (body.capabilities?.[capability] !== true) {
      throw new Error(`health expected capability ${capability}`);
    }
  }
}

export function validateChannels(value) {
  const body = requireObject(value, "channels");
  if (!Array.isArray(body.channels)) throw new Error("channels expected channels array");
  const seeded = body.channels.some((channel) => (
    channel
    && typeof channel === "object"
    && channel.slug === "purehub-official"
    && (channel.name === "PureHub Official" || channel.title === "PureHub Official")
  ));
  if (!seeded) throw new Error("channels expected the seeded PureHub Official channel");
}

export function validateCreatorSearch(value) {
  const body = requireObject(value, "creator-search");
  if (!Array.isArray(body.results)) throw new Error("creator-search expected results array");
  const seeded = body.results.some((result) => (
    result
    && typeof result === "object"
    && result.entityType === "creator"
    && result.entityId === "c1"
    && result.title === "林夕 Yuki"
  ));
  if (!seeded) throw new Error("creator-search expected the seeded Yuki creator result");
}

const validators = {
  health: validateHealth,
  channels: validateChannels,
  "creator-search": validateCreatorSearch
};

async function validateStdin(kind) {
  const validate = validators[kind];
  if (!validate) throw new Error("Unsupported smoke JSON validator.");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let body;
  try {
    body = JSON.parse(input);
  } catch {
    throw new Error(`${kind} returned malformed JSON`);
  }
  validate(body);
}

async function requireJson(name, path, validate) {
  const url = new URL(path, baseUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${name} failed: ${response.status} ${response.statusText} at ${url}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${name} returned malformed JSON at ${url}`);
  }
  validate(body);
  console.log(`ok ${name} ${url}`);
}

async function runSmoke() {
  for (const check of [
    { name: "home", path: "/" },
    { name: "explore", path: "/explore" },
    { name: "post-detail", path: "/post/post-1" },
    { name: "platform-rules", path: "/api/platform/rules" }
  ]) {
    const url = new URL(check.path, baseUrl);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${check.name} failed: ${response.status} ${response.statusText} at ${url}`);
    }
    console.log(`ok ${check.name} ${url}`);
  }

  await requireJson("health", "/api/health", validateHealth);
  await requireJson("channels", "/api/channels", validateChannels);
  await requireJson("creator-search", "/api/search?q=yuki&type=creator", validateCreatorSearch);

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
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (process.argv[2] === "validate-json") {
    await validateStdin(process.argv[3]);
  } else {
    await runSmoke();
  }
}
