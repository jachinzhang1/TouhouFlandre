import type { NextConfig } from "next";

const API_TARGET = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  rewrites: async () => [
    {
      source: "/api/:path*",
      destination: `${API_TARGET}/api/:path*`,
    },
  ],
};

export default nextConfig;
