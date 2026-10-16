# syntax=docker/dockerfile:1
FROM rust:1.87.0-bookworm AS rust-build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo build --locked --release -p sdr-server

# WASM and browser assets are platform-independent; do not emulate Node/tooling.
FROM --platform=$BUILDPLATFORM rust:1.87.0-bookworm AS wasm-build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN rustup target add wasm32-unknown-unknown
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install wasm-bindgen-cli --version 0.2.100 --locked
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --locked --release -p sdr-dsp-wasm --target wasm32-unknown-unknown \
    && wasm-bindgen target/wasm32-unknown-unknown/release/sdr_dsp_wasm.wasm \
       --target web --out-dir crates/dsp-wasm/pkg --out-name sdr_dsp_wasm

FROM --platform=$BUILDPLATFORM node:24.18.0-bookworm-slim AS web-build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install --global pnpm@11.18.0
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY apps/web ./apps/web
COPY --from=wasm-build /build/crates/dsp-wasm/pkg ./crates/dsp-wasm/pkg
RUN pnpm --filter @sdr-lab/web build

FROM debian:trixie-slim AS runtime
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/Enigmadie/sdr-lab" \
    org.opencontainers.image.revision="$VCS_REF" \
    org.opencontainers.image.description="Browser SDR lab with Rust/WASM and RTL-SDR Blog V4 support"
# Trixie's librtlsdr 2.0.2 supports RTL-SDR Blog V4. No apt work at pod startup.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates rtl-sdr \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/recordings \
    && chown 10001:10001 /data/recordings
WORKDIR /app
COPY --from=rust-build /build/target/release/sdr-server /usr/local/bin/sdr-server
COPY --from=web-build /build/apps/web/dist ./web
ENV SDR_BIND=0.0.0.0:3000 \
    SDR_WEB_DIR=/app/web \
    SDR_RECORDINGS_DIR=/data/recordings \
    SDR_SOURCE=synthetic
USER 10001:10001
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/sdr-server"]
