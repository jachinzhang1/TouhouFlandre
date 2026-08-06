import type { NextConfig } from "next";

const API_TARGET = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  rewrites: async () => [
    {
      source: "/api/:path*",
      destination: `${API_TARGET}/api/:path*`,
      // 注：08 §10.1 建议的 rewrite `ws: true` 在 Next 16 被配置校验拒绝
      // （"invalid field: ws for route"）；Next 16 dev 代理对带 Upgrade 头的请求
      // 走 httpxy proxy.ws（见 proxy-request.js），无需该字段即可代理 WS。
      // 生产 standalone 部署的 WS 代理历史问题仍在，走反向代理或直连（08 §15）。
    },
  ],
};

export default nextConfig;
