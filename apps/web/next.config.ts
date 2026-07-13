import type { NextConfig } from "next";

import { buildSecurityHeaders } from "./src/security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Linting runs once at the repo root (`pnpm lint`, flat config); Next's
  // legacy lint integration would double-run it with different assumptions.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders({ dev: process.env.NODE_ENV !== "production" }),
      },
    ];
  },
};

export default nextConfig;
