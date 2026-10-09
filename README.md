# SDR Lab

Browser SDR workbench built with **Vite + React + TypeScript**, **Rust/WASM**
and, in the next milestone, **WebGPU**. Designed for RTL-SDR Blog V4 on a
homelab machine, with an offline-friendly synthetic source.

## Current bootstrap

- Axum server generates complex I/Q and streams binary WebSocket blocks.
- A browser Worker runs Rust/WASM FFT and transfers spectra to the UI.
- Canvas 2D displays the spectrum; diagnostics show block processing time and gaps.
- The Rust server can serve the production frontend from the same origin.

**No RTL-SDR access, FM audio, recording or WebGPU implementation yet.**
The synthetic source does not touch existing radio services or hardware.

## Requirements

- Node.js 22.12+ (Node 24 recommended), pnpm 11.18.
- Rust 1.87+ with rustup; WASM target `wasm32-unknown-unknown`.
- `wasm-pack` is installed through pnpm. `pnpm wasm:setup` installs the WASM
  target and matching wasm-bindgen CLI using its published lockfile (compatible
  with Rust 1.87). The CLI version must match `crates/dsp-wasm`'s wasm-bindgen.

```sh
make install
make setup
make start
```

Open the Vite URL (normally http://127.0.0.1:5173). API and WebSocket are
proxied to the Rust server at 127.0.0.1:3000. First startup compiles Rust.
Two peaks should appear at −10.5 and +6 kHz relative to the center.

`pnpm dev` builds WASM once before starting both processes. After editing
DSP Rust code, run `pnpm wasm:build` again and reload the page.

## Checks and production build

```sh
make quality-check
make build
./target/release/sdr-server
```

`make lint` formats code and applies ESLint fixes. `make lint-check` checks
Prettier, ESLint, Rust formatting and Clippy without changing files.
`make check-types` builds WASM bindings and checks TypeScript; `make test`
runs Rust tests. Short aliases: `make b`, `s`, `i`, `l`, `t`.

For separate processes, use `make dev-client` and `make start-server`.
All commands also remain available as pnpm scripts.

Production UI is served at http://127.0.0.1:3000. Run from the repository
root or set `SDR_WEB_DIR` to the built `apps/web/dist` directory.
`SDR_BIND` defaults to `127.0.0.1:3000`; configure it explicitly for a container.

## Layout

```text
apps/web/src/app     Application shell
apps/web/src/pages   Pages with model, UI and rendering helpers
apps/web/src/shared  Shared I/Q decoding helpers
apps/web/src/workers DSP Worker and message contracts
crates/server        Axum API, WebSocket, synthetic source, static files
crates/dsp           Reusable Rust FFT and future DSP algorithms
crates/dsp-wasm      Browser-facing wasm-bindgen wrapper
crates/protocol      Binary I/Q frame encoder
docs/protocol.md     Wire format and current limitations
```

## Roadmap

WebGPU waterfall → real RTL-SDR capture → recording/replay → mono FM audio
→ GPU FFT comparison. Heavy sample buffers stay outside React state.
Large I/Q recordings are not tracked in Git.

WebGPU runs on the browser machine and requires a secure context (localhost
or trusted HTTPS). A single RTL-SDR can only be owned by one process at a time;
deployment must coordinate with existing receivers.

## Frontend conventions

Keep page composition, model hooks, UI components and processing helpers
separate. Use descriptive names, explicit component return types and readable
multiline JSX. High-frequency samples and spectra stay in worker buffers/refs,
not React state. UI text, errors, comments and repository docs are English.

Formatting and ESLint conventions are adapted from `admin-new`: single quotes,
semicolons, trailing commas, two-space indentation, explicit conditional braces
and ordered imports. The configuration is local and has no dependency on that
repository or its product libraries.
