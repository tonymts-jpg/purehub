import { expect, type APIRequestContext } from "@playwright/test";

const password = process.env.DEMO_ACCOUNT_PASSWORD ?? "PureHubDemo!2026";
export const authHeaders = {
  origin: new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001").origin
};

type SignUpInput = { name: string; email: string; password: string; handle: string };
export type PreparedFanRegistration = Pick<SignUpInput, "name" | "email" | "handle">;

async function postAuthWithRetry(request: APIRequestContext, path: string, data: Record<string, string>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request.post(path, { headers: authHeaders, data });
    if (response.status() !== 429) return response;

    const retryAfter = Number(response.headers()["x-retry-after"] ?? "10");
    await new Promise((resolve) => setTimeout(resolve, (Math.max(1, retryAfter) + 1) * 1000));
  }

  throw new Error(`Auth request remained rate limited for ${path} after 3 attempts.`);
}

export async function postSignIn(request: APIRequestContext, email: string, credentialPassword: string) {
  return postAuthWithRetry(request, "/api/auth/sign-in/email", { email, password: credentialPassword });
}

export async function postSignUp(request: APIRequestContext, input: SignUpInput) {
  return postAuthWithRetry(request, "/api/auth/sign-up/email", input);
}

export async function signIn(request: APIRequestContext, email: string) {
  const response = await postSignIn(request, email, password);
  expect(response.ok(), await response.text()).toBeTruthy();
}

export const signInFan = (request: APIRequestContext) => signIn(request, "fan@purehub.local");
export const signInCreator = (request: APIRequestContext, handle = "yuki") => signIn(request, `${handle}@purehub.local`);
export const signInAdmin = (request: APIRequestContext) => signIn(request, "admin@purehub.local");
export const signInSupport = (request: APIRequestContext) => signIn(request, "support@purehub.local");

export function prepareFanRegistration(label: string): PreparedFanRegistration {
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const prefix = label.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || "fan";
  const handle = `${prefix}-${nonce}`.slice(0, 30);
  const email = `${handle}@e2e.purehub.local`;
  return { name: `E2E ${label} Fan`, email, handle };
}

export async function registerPreparedFan(request: APIRequestContext, identity: PreparedFanRegistration) {
  const response = await postSignUp(request, { ...identity, password });
  expect(response.ok(), await response.text()).toBeTruthy();
  return { email: identity.email, handle: identity.handle };
}

export async function registerFan(request: APIRequestContext, label: string) {
  return registerPreparedFan(request, prepareFanRegistration(label));
}

export async function hasDatabase(request: APIRequestContext) {
  try {
    const health = await request.get("/api/health");
    if (!health.ok()) return false;
    return (await health.json()).dependencies.database.status === "ok";
  } catch {
    return false;
  }
}
