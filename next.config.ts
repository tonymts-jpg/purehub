import type { NextConfig } from "next";
import { dirname } from "path";
import { fileURLToPath } from "url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  output: "standalone",
  outputFileTracingRoot: projectRoot
};

export default nextConfig;
