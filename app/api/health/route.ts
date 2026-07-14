import net from "node:net";
import { NextResponse } from "next/server";
import { PAYMENT_PROVIDERS, SUPPORTED_LOCALES } from "@/lib/platform-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DependencyStatus = "ok" | "skipped" | "error";

function checkTcp(host: string | undefined, port: string | undefined, timeoutMs = 1200): Promise<{ status: DependencyStatus; detail: string }> {
  if (!host || !port) return Promise.resolve({ status: "skipped", detail: "not configured" });
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort)) return Promise.resolve({ status: "error", detail: `invalid port: ${port}` });

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: numericPort });
    const finish = (status: DependencyStatus, detail: string) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({ status, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish("ok", `${host}:${numericPort}`));
    socket.once("timeout", () => finish("error", `timeout connecting to ${host}:${numericPort}`));
    socket.once("error", (error) => finish("error", error.message));
  });
}

export async function GET() {
  const [database, redis, objectStorage] = await Promise.all([
    checkTcp(process.env.DB_HOST, process.env.DB_PORT ?? "5432"),
    checkTcp(process.env.REDIS_HOST, process.env.REDIS_PORT ?? "6379"),
    checkTcp(process.env.OBJECT_STORAGE_HOST, process.env.OBJECT_STORAGE_PORT ?? "9000")
  ]);

  const dependencies = { database, redis, objectStorage };
  const hasErrors = Object.values(dependencies).some((dependency) => dependency.status === "error");

  return NextResponse.json(
    {
      status: hasErrors ? "degraded" : "ok",
      service: "purehub-web",
      phase: process.env.PUREHUB_PHASE ?? "phase-1",
      environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0",
      locales: SUPPORTED_LOCALES,
      paymentProviders: Object.keys(PAYMENT_PROVIDERS),
      dependencies,
      timestamp: new Date().toISOString()
    },
    { status: hasErrors ? 503 : 200 }
  );
}
