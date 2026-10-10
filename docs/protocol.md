# I/Q stream — IQ01

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

Each session starts at sequence 0. Missing sequence numbers indicate lost
blocks; reset continuity-dependent DSP on gaps in future demodulators.
Current FFT blocks are independent. The server generates on demand, skips
missed timer ticks and closes a connection if sending takes over two seconds.
This bounds application backlog but does not yet provide end-to-end latency
control or capture timestamps; add those before real SDR/audio integration.

`GET /api/status` returns source, sample_rate, block_size and protocol.
No device control API or RTL-SDR capture is implemented yet.
