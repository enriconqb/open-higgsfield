import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: Infinity,
    },
    proxyClientMaxBodySize: Infinity,
  },
};

export default nextConfig;
