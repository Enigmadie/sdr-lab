ROOT_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
PM := pnpm --dir "$(ROOT_DIR)"

.DEFAULT_GOAL := help

.PHONY: help install setup build start dev lint lint-check test quality-check \
        check-types dev-client build-client start-client check-types-client \
        start-server build-server lint-server test-server wasm-build clean \
        b s i l t

help:
	@echo "install       Install JavaScript tooling and dependencies"
	@echo "setup         Install the WASM target and matching wasm-bindgen CLI"
	@echo "start / dev   Start Vite and the synthetic Rust server"
	@echo "build         Build WASM, the frontend and the release server"
	@echo "lint          Format code and apply ESLint fixes"
	@echo "lint-check    Check formatting, ESLint and Rust Clippy"
	@echo "check-types   Build WASM bindings and check TypeScript"
	@echo "test          Run Rust workspace tests"
	@echo "quality-check Run types, lint checks and tests"

install:
	$(PM) install
setup:
	$(PM) wasm:setup
build:
	$(PM) build
start:
	$(PM) start
dev: start
lint:
	$(PM) lint
lint-check:
	$(PM) lint:check
test:
	$(PM) test
quality-check:
	$(PM) quality:check
check-types:
	$(PM) check-types

dev-client: wasm-build
	$(PM) dev:web
start-client: dev-client
build-client: wasm-build
	$(PM) --filter @sdr-lab/web build
check-types-client: check-types
start-server:
	$(PM) dev:server
build-server:
	cargo build --manifest-path "$(ROOT_DIR)Cargo.toml" -p sdr-server --release
lint-server:
	cargo fmt --manifest-path "$(ROOT_DIR)Cargo.toml" --all -- --check
	cargo clippy --manifest-path "$(ROOT_DIR)Cargo.toml" --workspace --all-targets -- -D warnings
test-server:
	cargo test --manifest-path "$(ROOT_DIR)Cargo.toml" --workspace
wasm-build:
	$(PM) wasm:build

clean:
	cargo clean --manifest-path "$(ROOT_DIR)Cargo.toml"
	rm -rf "$(ROOT_DIR)apps/web/dist" "$(ROOT_DIR)crates/dsp-wasm/pkg"

b: build
s: start
i: install
l: lint
t: test
