import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  typescript: {
    // Allow production builds to complete even with TS errors.
    ignoreBuildErrors: true,
  },
  eslint: {
    // Allow production builds to complete even with ESLint errors.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
