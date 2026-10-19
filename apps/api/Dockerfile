# syntax=docker/dockerfile:1

# Native development uses cargo; this image is only for production deployment.
FROM rust:1.99.0-slim-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY .cargo ./.cargo
COPY .sqlx ./.sqlx
COPY crates/touhouflandre-core ./crates/touhouflandre-core
COPY apps/api/Cargo.toml apps/api/build.rs ./apps/api/
COPY apps/api/src ./apps/api/src
COPY apps/api/db ./apps/api/db
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/target \
    cargo build --locked --release --package touhouflandre-api --bins && \
    mkdir -p /out && \
    cp target/release/server target/release/seed target/release/migrate target/release/healthcheck /out/

# SQLx migrations are embedded in the Rust binaries; no external CLI is required.
# cc provides glibc/libgcc for the Rust Linux binaries, with no shell and no root.
FROM gcr.io/distroless/cc-debian13:nonroot AS runtime
COPY --from=build /out/server /out/seed /out/migrate /out/healthcheck /usr/local/bin/
COPY packages/data/src /catalog
ENV CATALOG_DATA_DIR=/catalog
EXPOSE 4000
CMD ["/usr/local/bin/server"]
