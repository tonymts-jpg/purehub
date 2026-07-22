import { expect, type APIRequestContext } from "@playwright/test";

const password = process.env.DEMO_ACCOUNT_PASSWORD ?? "PureHubDemo!2026";
export const authHeaders = {
  origin: new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001").origin
};

export async function postSignIn(request: APIRequestContext, email: string, credentialPassword: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await request.post("/api/auth/sign-in/email", {
      headers: authHeaders,
      data: { email, password: credentialPassword }
    });
    if (response.status() !== 429) return response;

    const retryAfter = Number(response.headers()["x-retry-after"] ?? "10");
    await new Promise((resolve) => setTimeout(resolve, (Math.max(1, retryAfter) + 1) * 1000));
  }

  throw new Error(`Sign in remained rate limited for ${email} after 3 attempts.`);
}

export async function signIn(request: APIRequestContext, email: string) {
  const response = await postSignIn(request, email, password);
  expect(response.ok(), await response.text()).toBeTruthy();
}

export const signInFan = (request: APIRequestContext) => signIn(request, "fan@purehub.local");
export const signInCreator = (request: APIRequestContext, handle = "yuki") => signIn(request, `${handle}@purehub.local`);
export const signInAdmin = (request: APIRequestContext) => signIn(request, "admin@purehub.local");
export const signInSupport = (request: APIRequestContext) => signIn(request, "support@purehub.local");

export async function hasDatabase(request: APIRequestContext) {
  try {
    const health = await request.get("/api/health");
    if (!health.ok()) return false;
    return (await health.json()).dependencies.database.status === "ok";
  } catch {
    return false;
  }
}
