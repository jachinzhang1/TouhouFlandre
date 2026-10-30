# syntax=docker/dockerfile:1

# ---------- 构建层：静态编译，产物含 server/seed/goose/healthcheck ----------
FROM golang:1.26-alpine AS build
WORKDIR /src
RUN apk add --no-cache ca-certificates
# 依赖层缓存：仅 go.mod/go.sum 变化才重下模块
COPY apps/api/go.mod apps/api/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/api/ ./
# 题库 JSON 供 seed 命令读取（runtime 的 CATALOG_DATA_DIR 指向 /catalog）
COPY packages/data/src/ packages/data/src/

RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -ldflags="-s -w" -o /out/seed ./cmd/seed
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -ldflags="-s -w" -o /out/goose github.com/pressly/goose/v3/cmd/goose
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -ldflags="-s -w" -o /out/healthcheck ./cmd/healthcheck

# ---------- 运行层：distroless static，无 shell、非 root ----------
FROM gcr.io/distroless/static-debian13:nonroot AS runtime
COPY --from=build /out/server /out/seed /out/goose /out/healthcheck /usr/local/bin/
COPY --from=build /src/migrations /migrations
COPY --from=build /src/packages/data/src /catalog
ENV CATALOG_DATA_DIR=/catalog
EXPOSE 4000
# 单进程容器：默认跑 server；migrate/seed 由 compose 覆盖 command
CMD ["/usr/local/bin/server"]
