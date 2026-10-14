# Recordings and reproducible DSP fixtures

## Storage and discovery

Recordings are files on the **server**, not browser storage or React state.
`SDR_RECORDINGS_DIR` selects a writable directory; the default is `recordings/`
relative to the server's working directory. From the repository root this is
`/Users/hermes/_dev/sdr-lab/recordings`. The directory and `*.iqrec` files are
ignored by Git.

The **Recordings** panel shows the server endpoint, absolute storage directory,
catalog size, and each file's absolute path. Entries include name, creation time,
source, duration, size, sample rate, center frequency, gain, format, saved blocks,
sequence gaps, and completion status. Names can be changed; deleting an entry
removes both its data file and metadata. Files with missing/unreadable metadata
are listed explicitly as unindexed files rather than silently disappearing.

Each recording consists of two files:

```text
<timestamp>-<process-id>.iqrec   Full I/Q blocks, length-prefixed
<timestamp>-<process-id>.json    Human-readable capture metadata
```

Metadata is atomically replaced using a temporary sidecar file. The catalog is
rebuilt from disk, so recordings survive server restarts. An unfinished recording
is marked `interrupted` on startup; complete frames are scanned to recover its
duration/block counts. A truncated final frame is retained and produces an
explicit replay error if reached. A failed disk operation is marked `failed`.

For homelab deployment, configure an **absolute path on a persistent writable
volume**, for example `SDR_RECORDINGS_DIR=/data/recordings`. The existing
read-only development runtime mount is not a recordings volume. Provisioning
that volume and deploying the new binary/UI remain deployment work. Directory
creation and recovery happen at server startup; an inaccessible directory fails
startup with an error.

## Recording

Connect to live capture or the synthetic source, choose a descriptive fixture
name and a duration, then press **Record capture**. Recording is limited to
1–60 seconds and 512 MiB per file. At 2.4 MS/s uint8 I/Q, ten seconds is about
48 MB and one minute about 288 MB, plus framing overhead. The actual duration
is block-aligned and may differ slightly from the requested wall-clock duration.

The server records every complete capture block **before** browser ACK shedding.
Live uint8 samples are preserved, rather than saving only the worker's latest
2048-sample FFT window. One server recording is allowed at a time. The recording
command travels over the owning capture WebSocket; a replay cannot start capture
or record itself. Stop, disconnect, capture failure, or retune finalizes the file.
Retuning never joins different receiver settings in one recording.

Disk writes run in a separate task with an eight-block bounded channel (about
512 KiB for current live blocks). A full queue stops recording and records the
reason; capture continues. Writes and final flush have a two-second timeout.
No unbounded I/Q history is held in RAM. Browser network/display losses are
separate from recorded capture sequence gaps. USB/librtlsdr internal losses
are still not measured by the application sequence counter.

## Replay and FFT experiments

**Play from start** opens the saved recording in the existing Worker/WASM FFT,
Canvas spectrum and WebGPU waterfall. Replay does not acquire the dongle.
Pause/resume, restart, seek by seconds, and return to capture are available.
The selected fixture and current playback position remain visible in the catalog.
Starting/restarting/seeking creates a fresh DSP session and clears waterfall
history. Waterfall pause remains an independent visualization control.

The server reads at most one saved block at a time, sends it over WebSocket,
waits for its matching ACK, and paces it at its sample duration. Slow DSP stretches
playback rather than skipping recorded data or accumulating a queue. Seeking
scans frames sequentially to a block boundary; these short recordings do not
need a separate index yet. Position notifications use a bounded worker mailbox.
Playback positions count saved samples, excluding time lost in capture gaps;
original sequence numbers preserve those discontinuities for DSP reset handling.

Change DSP code, rebuild `pnpm wasm:build`, reload the UI and select the same
fixture to exercise the new implementation on the same input. Frontend-only
changes are handled by Vite during development. Production UI needs rebuilding.
Replay uses the current FFT path: live IQ02 frames still visualize their latest
2048 samples. Recording preserves the full payload for future FM processing.

`.cs16` import with explicit metadata is a follow-up. `.iqrec` is an internal
framed container, not a raw `.cs16`/`.cs8` file; changing an extension does not
convert formats.

## API and checks

- `GET /api/recordings`: directory, limits, metadata catalog, unindexed files.
- `PUT /api/recordings/{id}` with `{ "name": "FM filter fixture" }`: rename.
- `DELETE /api/recordings/{id}`: delete data and metadata.
- `GET /api/recordings/{id}/replay?start=0`: replay WebSocket.
- Capture WebSocket command `record:{"name":"FM fixture","seconds":10}`;
  `record-stop` finalizes it. Invalid requests return `record-error:<detail>`
  without closing the signal stream.

Data frames are stored as a little-endian u32 byte length followed by an
unchanged IQ01/IQ02 frame. Playback validates framing before allocation/decoding
and reports malformed or truncated data explicitly. Files are resolved using
validated server-generated IDs, never user-supplied filesystem paths.

Run `pnpm test:recordings` for isolated synthetic and RTL fixture servers. It
checks recording before ACK shedding, byte-identical replay, seek/repeat,
validation, active-file mutation rejection, capture boundaries, persistence,
interruption recovery, rename and deletion. Test files live temporarily under
`target/` and are removed on completion. No USB hardware is used.
