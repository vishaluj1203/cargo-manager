import type { NextConfig } from "next";

try {
  process.loadEnvFile("../../.env.local");
} catch {
  // Vercel and other production hosts provide environment variables directly.
}

const nextConfig: NextConfig = {
  transpilePackages: ["@cargo/contracts"],
  poweredByHeader: false,
};

export default nextConfig;
