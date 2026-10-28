import type { NextConfig } from "next";

import { configuredBasePath } from "./src/base-path";

const basePath = configuredBasePath();

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  serverExternalPackages: ["mysql2"],
  experimental: {
    serverActions: {
      bodySizeLimit: Infinity,
    },
    proxyClientMaxBodySize: Infinity,
  },
};

export default nextConfig;
