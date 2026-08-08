# syntax=docker/dockerfile:1

# ---------- 基础层：corepack 提供 pnpm（版本取 package.json packageManager） ----------
FROM node:24-alpine AS base
RUN corepack enable

# ---------- 依赖层：只拷贝 workspace 清单，最大化依赖层缓存 ----------
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/data/package.json packages/data/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- 构建层：next build（standalone，tracing root=仓库根） ----------
FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
# Next 16 standalone 在构建期把 rewrites 目标固化进 routes-manifest，
# 故 API 目标必须是构建参数（运行期 env 无效）。compose 传 http://api:4000。
ARG API_PROXY_TARGET=http://127.0.0.1:4000
ENV API_PROXY_TARGET=$API_PROXY_TARGET
# 直连 API 模式的可选构建参数；留空则走 Next rewrites 同源代理
ARG NEXT_PUBLIC_API_BASE_URL=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=cache,target=/repo/apps/web/.next/cache \
    pnpm --filter @touhouflandre/web build

# ---------- 运行层：非 root，仅拷贝 standalone 产物 ----------
FROM node:24-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs
# outputFileTracingRoot=仓库根 → server.js 位于 standalone/apps/web/
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /repo/content ./content
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
