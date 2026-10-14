# Live RTL-SDR receiver

## First signal: broadcast FM

Use the long telescopic pair as a straight vertical dipole: one arm up, one down,
about 75 cm per arm measured from the base to the tip. Place it near a window,
clear of metal, radiators and power supplies; keep both arms free of contact.
The supplied suction mount is convenient. Start indoors before optimizing.

Initial settings: 97.1 MHz center, 2.4 MS/s capture, 29.7 dB tuner gain. Other
previously observed local stations: 89.7, 93.3, 98.9 and 101.4 MHz. An FM station
appears as a broad occupied patch, not a pure tone. A narrow center spike may be
a receiver artifact. This milestone displays spectrum; it does not play audio.

## Capture adapter

The server invokes `rtl_sdr`, which uses the installed V4-compatible librtlsdr.
This avoids a build-time dependency on USB libraries and keeps the synthetic
server usable on macOS without a receiver. Debian trixie's rtl-sdr/librtlsdr 2.0.2
supports Blog V4. There is no direct unsafe FFI in this adapter.

Environment:

| Variable             | Default          | Meaning                                      |
| -------------------- | ---------------- | -------------------------------------------- |
| `SDR_SOURCE`         | `synthetic`      | `synthetic` or `rtlsdr`                      |
| `SDR_DEVICE`         | `homelab_sdr`    | Dongle serial or rtl_sdr device selector     |
| `SDR_RTL_EXECUTABLE` | `rtl_sdr`        | Capture executable, overridable for fixtures |
| `SDR_BIND`           | `127.0.0.1:3000` | HTTP/WebSocket listen address                |
| `SDR_WEB_DIR`        | `apps/web/dist`  | Built UI directory                           |

Capture delivers 32768-complex-sample unsigned uint8 I/Q blocks. IQ02 preserves
the raw payload: 2.4 MS/s is approximately 4.8 MB/s plus framing overhead, rather
than 19.2 MB/s of float32 expansion. The worker converts only the latest 2048
samples to float32 for a spectrum snapshot. This is intentionally sampled
visualization, not processing every sample for demodulation or recording.
The server's [recording writer](recordings.md) separately saves complete capture
blocks before browser ACK shedding, preserving all captured samples for replay.

The server continuously drains capture stdout. While a WebSocket block awaits
ACK, subsequent capture blocks are discarded and their sequence numbers remain
visible as gaps. The application retains one partial capture block and one
in-flight network block. OS pipes and librtlsdr USB buffers remain internal to
the capture process; hardware/USB sample losses are not directly measured by
this adapter's sequence counter. Capture errors go to server logs and surface
as an English stream error in the browser.

## Ownership and tuning

`GET /api/iq?owner_id=<session-id>` claims the device for one browser session.
The browser generates a cryptographically random 128-bit session ID, including
on plain HTTP where WebGPU is unavailable. A second live stream receives a device-busy
error; multi-client observation is a later feature. External processes remain
exclusive USB owners too: switching existing radio services is a GitOps action.

`GET /api/status` reports source, protocol, block size, sample rate, requested
settings and whether a browser owns the device. `PUT /api/receiver` accepts:

```json
{
  "owner_id": "the-connected-browser-session-id",
  "settings": {
    "center_hz": 97100000,
    "sample_rate": 2400000,
    "gain_db": 29.7
  }
}
```

Only the current owner can tune. Supported rates are 240000, 1024000 and 2400000
complex samples/s. Manual gain must match a supported tuner step; `null` means
automatic tuner gain. Frequencies are limited to 24–1766 MHz for this initial
adapter; V4 HF modes are not yet exposed. Bias tee remains off.

The PUT acknowledges validated requested settings, not completed hardware setup.
Retuning stops and reaps the old process, then starts a new one. The sequence
continues with an explicit gap; no block combines samples across the boundary.
Frames carry their actual capture configuration. The worker resets DSP context
and the waterfall clears when the captured band changes, including while paused.
If capture restart fails, the stream reports an error and ownership is released.

Disconnect, stream stall timeout, capture EOF or capture startup failure stops
and reaps the child before releasing the browser lease. The five-second capture
watchdog also handles a device that produces no output.

## Homelab development deployment

The GitOps `radio` mode switch includes `sdr-lab`. Exactly one of readsb, rtl433,
meteor and sdr-lab has one replica; the others have zero. Runtime is pinned to
OptiPlex (`homelab/role=apps`) with USB passthrough and `Recreate` strategy.

For this development milestone, the Linux x86_64 server binary and production
UI are staged at `/opt/sdr-lab/runtime/sdr-server` and `/opt/sdr-lab/runtime/web`
on OptiPlex. They are mounted read-only by a Debian trixie container, which installs
the pinned V4-compatible rtl-sdr package at startup. The binary was built with
Rust 1.87 in a temporary build pod, without installing a host Rust toolchain.
Stage artifacts before enabling the mode; use an atomic replacement for later
binary updates and restart the lab pod with no connected client. A versioned
multi-stage production image/CI will replace this development hostPath runtime.

HTTP ingress uses Host `sdr-lab.home` on the LAN ingress IP. For WebGPU, use a
localhost port-forward until trusted HTTPS is configured:

```sh
kubectl -n radio port-forward --address 127.0.0.1 svc/sdr-lab 3003:80
```

Open `http://127.0.0.1:3003`. This is a secure context for WebGPU. A Kubernetes
port-forward travels via the API server; this does not by itself verify the
future browser → local ingress → OptiPlex path with VPN enabled. That network
acceptance check remains a separate TODO.

For a direct LAN development tunnel, obtain the current lab pod IP and forward
through OptiPlex instead of the Kubernetes API server:

```sh
POD_IP=$(kubectl -n radio get pod -l app=sdr-lab -o jsonpath='{.items[0].status.podIP}')
ssh -N -L "127.0.0.1:3004:${POD_IP}:3000" godo@192.168.1.40
```

Open `http://127.0.0.1:3004`; recreate the tunnel if the pod IP changes. The
2026-10-11 live smoke measured 4.806 MB/s over ten seconds at 2.4 MS/s, mean
RTT 4.214 ms, and one skipped source block. Browser spectrum near 97.0 MHz was
about 19 dB above an adjacent quiet band. Frequency/rate changes, a busy second
browser and release of the capture process on disconnect were also verified.

Rollback: set sdr-lab to zero and meteor to one in
`homelab-gitops/workloads/radio/kustomization.yaml`, commit/push and verify ArgoCD
sync. Restore the meteor antenna geometry (54 cm arms, horizontal 120° V).

## Reproducible checks

`make quality-check` covers wire framing, decoding, continuity, settings validation
and lease release. The synthetic transport test still runs against a local
synthetic server with `pnpm test:stream`.

For a hardware-independent receiver integration test, start:

```sh
SDR_SOURCE=rtlsdr SDR_BIND=127.0.0.1:3002 \
  SDR_RTL_EXECUTABLE="$PWD/apps/web/tests/fixtures/rtl-sdr.mjs" \
  ./target/release/sdr-server
pnpm test:receiver
```

The fixture emits uint8 I/Q without USB access. The test checks exclusive browser
ownership, rejected settings, owner-only tuning, metadata after retune, and lease
release on disconnect. Override the endpoint with `SDR_RECEIVER_URL` if necessary.
