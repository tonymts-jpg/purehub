import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@/lib/prisma";
import { authSecondaryStorage } from "@/lib/redis";

export const auth = betterAuth({
  appName: "PureHub",
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secondaryStorage: authSecondaryStorage,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128
  },
  user: {
    additionalFields: {
      handle: { type: "string", required: true, input: true },
      avatar: { type: "string", required: false, defaultValue: "avatar-1", input: false },
      role: { type: "string", required: false, defaultValue: "fan", input: false },
      creatorStatus: { type: "string", required: false, defaultValue: "none", input: false },
      status: { type: "string", required: false, defaultValue: "active", input: false }
    }
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const handle = String(user.handle ?? "").trim().toLowerCase();
          if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(handle)) throw new Error("Handle must be 3-30 lowercase letters, numbers, or hyphens.");
          return { data: { ...user, handle, role: "fan", creatorStatus: "none", status: "active", avatar: "avatar-1" } };
        }
      }
    }
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    storeSessionInDatabase: true
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30
  },
  advanced: {
    useSecureCookies: process.env.APP_ENV === "production" || process.env.BETTER_AUTH_SECURE_COOKIES === "true",
    cookiePrefix: "purehub"
  },
  trustedOrigins: [
    process.env.BETTER_AUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    "http://localhost:3000",
    "http://127.0.0.1"
  ].filter((value): value is string => Boolean(value))
});

export type AuthSession = typeof auth.$Infer.Session;
