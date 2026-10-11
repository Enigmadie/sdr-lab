# I/Q stream — IQ01

The synthetic source uses IQ01; live RTL-SDR uses IQ02 below. Both use the same
sequence ACK flow control.

`GET /api/iq` upgrades to WebSocket. One binary message is one complete block.
All numeric fields are little-endian; magic is literal ASCII.

| Offset | Bytes     | Field                                                |
| ------ | --------- | ---------------------------------------------------- |
| 0      | 4         | `IQ01` (format version 1)                            |
| 4      | 4         | Sequence, unsigned 32-bit, wraps at 2³²              |
| 8      | 4         | Sample rate, unsigned 32-bit, complex samples/second |
| 12     | 4         | Number of complex samples, unsigned 32-bit           |
| 16     | count × 8 | Interleaved float32: I₀, Q₀, I₁, Q₁, …               |

Current source: two fixed complex tones at +6 kHz and −10.5 kHz, a continuous-phase
tone sweeping sinusoidally between ±14 kHz over eight seconds, a +18 kHz burst
lasting 150 ms every two seconds, and deterministic noise. The stream runs at
48 kS/s with 2048 samples/block. Samples are normalized full-scale values,
not volts. Spectrum uses a periodic Hann window, window-gain normalization,
and fftshift. Values are dBFS per bin, not dBm or calibrated PSD.

Sequence follows the source timeline and wraps at 2³². Missing sequence numbers
indicate skipped source blocks, including blocks skipped while awaiting client
credit and missed timer ticks. The synthetic generator keeps advancing while a
client is slow. The worker resets its DSP context on a gap or sample-rate/block-size
change. Duplicate and backwards sequences are rejected without inflating loss
counters. Current FFT blocks are independent; future demodulators must use the
same reset boundary.

## Flow control and diagnostics

The server sends at most **one unacknowledged binary block**. After decoding and
WASM processing, the worker sends a text message `ack:<sequence>` (unsigned decimal).
Only an ACK matching the in-flight block releases credit. There is no capture
backlog: source blocks skipped while waiting are reflected in the next sequence.
A connection closes after two seconds without ACK or if a socket send takes over
two seconds. Disconnecting drops the per-session source and releases all work.
Clients implementing IQ01 must implement this ACK exchange.

Application text messages `ping:<token>` (at most 64 bytes) are echoed unchanged.
The worker uses its monotonic clock to measure round-trip time without assuming
synchronized clocks. This is **not** one-way latency or capture-to-screen age;
IQ01 has no capture timestamp. Throughput counts received binary bytes including
headers; block rate and throughput use actual elapsed diagnostic intervals.
DSP duration includes decoding and FFT, with a session peak and a block-duration
budget. Last-block age exposes stalls even when no new spectra arrive.

The worker-to-UI spectrum mailbox holds one posted frame and one replaceable
latest frame. Older pending spectra are coalesced and counted separately from
I/Q loss. Diagnostics are published at most twice per second with at most one
unconsumed metrics message. I/Q and spectrum arrays stay outside React state.
Reconnect starts a fresh diagnostics session and clears waterfall history.

Verification: `pnpm test` covers continuity boundaries. With a local server
running, `pnpm test:stream` checks withheld/wrong ACKs, sequence gaps, ping echoes
and stall disconnection. Override the endpoint with `SDR_TEST_URL` if needed.

`GET /api/status` returns source, sample_rate, block_size and protocol.
It also reports receiver settings and device ownership. Live capture and tuning
are documented in [Live receiver](receiver.md).

## IQ02 — raw RTL-SDR capture

| Offset | Bytes     | Field                                               |
| ------ | --------- | --------------------------------------------------- |
| 0      | 4         | ASCII `IQ02`                                        |
| 4      | 4         | Sequence, uint32                                    |
| 8      | 4         | Complex sample rate, uint32                         |
| 12     | 4         | Complex sample count, uint32                        |
| 16     | 4         | Center frequency in Hz, uint32                      |
| 20     | 4         | Sample format: uint32 `1` = offset-binary uint8 I/Q |
| 24     | count × 2 | Interleaved uint8 I₀, Q₀, I₁, Q₁, …                 |

All numeric fields are little-endian. Current capture blocks contain 32768
complex samples. Conversion is `(value - 127.5) / 127.5`. Center-frequency changes
are discontinuities even at the same sample rate. The sequence continues through
retunes, with a skipped sequence to mark the restart boundary.
