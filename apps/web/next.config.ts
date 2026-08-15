import type { NextConfig } from "next";
import { resolve } from "node:path";

try {
  process.loadEnvFile("../../.env.local");
} catch {
  // Vercel and other production hosts provide environment variables directly.
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  transpilePackages: ["@cargo/contracts", "@cargo/security"],
  poweredByHeader: false,
};

export default nextConfig;
