# SDR Lab

Browser SDR workbench built with **Vite + React + TypeScript**, **Rust/WASM**
and **WebGPU**. Designed for RTL-SDR Blog V4 on a
homelab machine, with an offline-friendly synthetic source.

## Current features

- Axum server streams synthetic I/Q or live RTL-SDR Blog V4 capture.
- A browser Worker runs Rust/WASM FFT and transfers spectra to the UI.
- Canvas 2D displays the spectrum; diagnostics show throughput, DSP time, RTT,
  gaps and bounded queue depth.
- Live receiver controls tune frequency, sample rate and gain with exclusive
  browser-session ownership. Disconnecting stops capture and releases USB.
- WebGPU renders a 512-row waterfall using an `r32float` ring texture and WGSL.
- Pause/resume and color-range controls change the waterfall independently of FFT.
- GPU unavailability and device loss are reported with a retry action; the CPU
  spectrum continues to work without WebGPU.
- The Rust server can serve the production frontend from the same origin.

**No FM audio or recording yet. FFT still runs in WASM, not on GPU.**
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
Two fixed peaks appear at −10.5 and +6 kHz relative to the center, alongside a
sweeping tone and periodic bursts. The waterfall shows their history; newest
spectra appear at the top. See [Waterfall architecture](docs/waterfall.md).

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
runs JS continuity/decoding and Rust tests. Short aliases: `make b`, `s`, `i`, `l`, `t`.

For separate processes, use `make dev-client` and `make start-server`.
All commands also remain available as pnpm scripts.

Production UI is served at http://127.0.0.1:3000. Run from the repository
root or set `SDR_WEB_DIR` to the built `apps/web/dist` directory.
`SDR_BIND` defaults to `127.0.0.1:3000`; configure it explicitly for a container.

## Live RTL-SDR

Install a V4-compatible `rtl-sdr` package (Debian trixie provides librtlsdr 2.0.2).
With the dongle free from other receiver processes:

```sh
SDR_SOURCE=rtlsdr SDR_DEVICE=homelab_sdr ./target/release/sdr-server
```

The first connected browser owns the receiver. Start at 97.1 MHz, 2.4 MS/s and
29.7 dB gain; the UI explains controls and offers narrower capture rates.
See [Live receiver](docs/receiver.md) for antenna setup, deployment and tests.

## Layout

```text
apps/web/src/app     Application shell
apps/web/src/pages   Pages with model, UI and rendering helpers
apps/web/src/shared  Shared I/Q decoding helpers
apps/web/src/workers DSP Worker and message contracts
apps/web/src/gpu     WebGPU renderer and WGSL shader
crates/server        Axum API, WebSocket, synthetic source, static files
crates/dsp           Reusable Rust FFT and future DSP algorithms
crates/dsp-wasm      Browser-facing wasm-bindgen wrapper
crates/protocol      Binary I/Q frame encoder
docs/protocol.md     Wire format and current limitations
```

## Roadmap

Recording/replay → mono FM audio
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
