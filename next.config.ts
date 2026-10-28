import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mysql2"],
  experimental: {
    serverActions: {
      bodySizeLimit: Infinity,
    },
    proxyClientMaxBodySize: Infinity,
  },
};

export default nextConfig;
