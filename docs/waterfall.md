# WebGPU waterfall

## Data path

```text
Synthetic I/Q → WebSocket → Worker → Rust/WASM FFT
                                        ↓ transferable Float32Array
                                  latest-frame ref
                                        ↓ requestAnimationFrame
                                  WebGPU ring texture
                                        ↓ WGSL fragment shader
                                  waterfall canvas
```

FFT remains on the CPU in WASM. WebGPU handles visualization and color mapping,
not signal demodulation or GPU FFT. Raw spectra stay outside React state.

## GPU history

`WaterfallRenderer` owns an `r32float` texture: one frequency bin per column and
512 history rows. With a 2048-bin FFT this occupies 4 MiB. Each new displayed
spectrum uploads only one 8 KiB row using `GPUQueue.writeTexture`.

The write cursor wraps at row 512. The shader maps screen Y to spectrum age and
looks up `(nextRow + historyRows - 1 - age) % historyRows`. No old rows are shifted
or copied. Newest spectra appear at the top, older spectra below.

A 32-byte uniform buffer holds viewport dimensions, bin count, ring cursor,
valid row count and color floor/ceiling. A fullscreen triangle samples the ring
with `textureLoad` and interpolates a five-color palette. There is no sampler;
the float texture uses an explicit `unfilterable-float` binding.

Changing the color range redraws existing data without recomputing FFT or
uploading history. The range is constrained to at least 5 dB.

## Display behavior

- Pause stops history uploads, not the WebSocket, Worker or CPU spectrum.
- Resume appends the latest spectrum; missed history is not buffered.
- Reconnect resets the valid row count and cursor, hiding old texture contents.
- A changed FFT size reallocates the history texture and clears the ring.
- Canvas dimensions follow CSS size and device pixel ratio, capped by GPU limits.
- Only the latest spectrum available at a display frame is consumed. Rows are
  displayed spectra, not a calibrated wall-clock time axis; hidden tabs and
  slow displays may skip rows. End-to-end latency control is a later milestone.

## GPU lifecycle

Initialization requires a secure context and an available WebGPU adapter. The
renderer waits for its pipeline to compile before configuring the canvas.
Abort checks prevent a cancelled React StrictMode mount from configuring a
canvas owned by a newer renderer.

Unavailable WebGPU leaves the CPU spectrum usable. Device loss or uncaptured
GPU errors stop the rendering loop, release resources and show a retry action.
Retry creates a new device and empty history. Unmount aborts initialization,
cancels animation and destroys the texture, uniform buffer and device.

## Synthetic scene

The server provides fixed tones at −10.5 and +6 kHz, an eight-second sine sweep
between ±14 kHz, and a +18 kHz burst lasting 150 ms every two seconds. The sweep
integrates frequency into phase so block boundaries do not reset the signal.
Noise is deterministic per connection; reconnect restarts the scene.

## Verification

Run `make quality-check` and `make build`, then open the application in a WebGPU
browser on localhost:

1. Fixed tones produce vertical tracks, the sweep moves across frequency, and
   bursts appear intermittently. Let the history wrap past 512 received rows.
2. Pause: the waterfall image freezes while the CPU spectrum and block sequence
   continue updating. Resume: new rows appear again.
3. Change color floor/ceiling while paused: stored history changes color.
4. Reconnect: old history clears and new rows start at the top.
5. Resize to mobile width: no horizontal overflow or GPU validation errors.
6. Without `navigator.gpu`, verify the unavailable message and working CPU FFT.
7. Simulate device loss: verify the retry action restores GPU rendering.

The 2026-10-10 browser smoke check verified actual WebGPU rendering, single-row
8 KiB uploads, ring wrap, frozen pause screenshots, recoloring, reconnect,
mobile layout, no-WebGPU CPU operation, and recovery after device destruction.
