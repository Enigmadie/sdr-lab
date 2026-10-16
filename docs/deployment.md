# Production image and GitOps delivery

## Delivery boundary

The application image contains the Rust server, built UI/WASM and Debian trixie's
V4-compatible `rtl_sdr`/librtlsdr. It does not contain recordings, credentials or
USB devices. No packages are installed when the pod starts.
UI/WASM build tools run on the builder's native architecture; only the server
and runtime target the deployment architecture (amd64 for OptiPlex).

Runtime browser traffic must follow **browser → LAN ingress → OptiPlex**. GHCR,
GitHub Actions and dependency downloads are deployment traffic, not I/Q traffic.
Do not publish SDR Lab through the VPS reverse proxy or VPN-side ingress.
CI/CD does not configure DNS, client VPN routing or trusted HTTPS.

## CI

`.github/workflows/ci.yml` runs on pull requests, main pushes and manual dispatch:

1. Pinned Node/pnpm and Rust 1.87, WASM bindings matching wasm-bindgen 0.2.100.
2. Types, formatting, ESLint, Clippy, JS/Rust and image-promotion unit tests.
3. Synthetic and RTL fixture recording/replay integration tests, receiver ownership
   and tuning checks without hardware.
4. Production build, HTTP/JS/worker/WASM asset checks, capture/record/replay smoke
   and ACK/backpressure/timeout transport checks.
5. Build the Linux amd64 image (OptiPlex), repeat smoke/transport checks against
   that exact image, then publish it **only on a main push**.

The image is tagged `ghcr.io/enigmadie/sdr-lab:sha-<full commit SHA>`; deployment
uses the resulting `@sha256:...` digest, not `latest`. BuildKit/GitHub caches reduce
repeat downloads. PRs and manual dispatch never publish or promote.
Base OS tags receive security updates on rebuild; the deployed image digest is
immutable, but builds are not claimed to be byte-for-byte reproducible.

Recommended repository protection: require the `quality` and `image` jobs before
merging, disallow direct main writes, and require review of workflow changes.

## Enable CD once, deliberately

No cluster credentials belong in this repository. CD creates/updates a PR in
`Enigmadie/homelab-gitops`; merging it lets the existing ArgoCD application deploy.
Auto-merge is intentionally not enabled.

1. Verify GHCR package visibility. For a public app package, enable public pulls;
   for a private package, configure an `imagePullSecret` in namespace `radio`
   before merging deployment changes. Never put a registry token in a manifest.
2. Create a fine-grained token restricted to `Enigmadie/homelab-gitops`, with
   repository contents and pull-request read/write permissions. Store it as
   **`SDR_GITOPS_TOKEN`** in this app repository's Actions secrets. A GitHub App
   installation token is an alternative for later hardening.
3. Set Actions variable **`SDR_GITOPS_PROMOTION_ENABLED=true`** only when ready.
4. Push an approved app commit to main. Review the generated
   `automation/sdr-lab-image` PR and merge it to deploy.

The promotion script changes only the SDR Lab Deployment in
`workloads/radio/lab.yaml`: replaces the development command/runtime mount with
the tested image, sets production web/recording paths, and adds recording storage.
It preserves replicas (including zero), radio mode, USB access, probes, resources,
Service, ingress and other YAML documents. It rejects unexpected images, duplicate
deployments, non-Recreate rollout and non-apps node placement.
It never scales meteor/readsb/rtl433 or changes radio mode.

Local preview (work on a copy, not the live GitOps checkout):

```sh
cp ../homelab-gitops/workloads/radio/lab.yaml target/lab-preview.yaml
node scripts/promote-image.mjs target/lab-preview.yaml \
  ghcr.io/enigmadie/sdr-lab@sha256:<64-hex-digest>
git diff --no-index ../homelab-gitops/workloads/radio/lab.yaml target/lab-preview.yaml
```

## Recordings and USB

- Host path: **`/opt/sdr-lab/recordings`** on the OptiPlex apps node.
- Pod path: **`/data/recordings`**, explicitly set by `SDR_RECORDINGS_DIR`.
- `DirectoryOrCreate` creates a root-owned persistent host directory. It survives
  pod/image replacement, but is **not replicated, backed up or quota-limited**.
  Monitor free disk space and remove unwanted fixtures through the catalog.
- This intentionally uses local disk rather than introducing NFS/PVC dependency
  for the first deployment. Do not move the pod to another node without moving
  the data; revisit node affinity if more nodes receive `homelab/role=apps`.
- The image defaults to UID 10001 and synthetic input. Live GitOps explicitly
  uses UID/GID 0 and the existing privileged USB mount. Do not claim this is a
  hardened USB security boundary; reduce privileges separately after validation.
- `Recreate` preserves exclusive device ownership across rollouts. Capture starts
  only with an owning browser session. SIGTERM and SIGINT initiate server shutdown;
  interrupted files are recovered by the recording catalog on next startup.

## Local image check

```sh
make image-build
docker volume create sdr-lab-recordings
docker run --rm --name sdr-lab-local -p 127.0.0.1:3000:3000 \
  --mount source=sdr-lab-recordings,target=/data/recordings sdr-lab:local
```

In another terminal, run `make test-production` and `pnpm test:stream`. These
checks require synthetic mode and create/delete a short smoke recording. For a
different URL set `SDR_SMOKE_URL` and `SDR_TEST_URL` respectively. Tests fetch real
production assets but do not replace a browser/WebGPU smoke check.

## First deployment acceptance (not automated by CI)

1. Confirm image pull, ArgoCD revision/health and readiness. Ensure other radio
   modes remain at zero before opening the live browser.
2. Use a localhost LAN SSH/port-forward for WebGPU until trusted LAN HTTPS exists.
   Plain HTTP `sdr-lab.home` is not a WebGPU secure context.
3. With the client VPN enabled, check DNS and the actual route/connections to the
   LAN ingress. Measure sustained 2.4 MS/s I/Q (~4.8 MB/s), RTT and dropped blocks.
   An SSH-forward test alone does not validate the complete ingress/VPN route.
4. Capture a short real FM fixture, verify its visible host-backed catalog/path,
   and replay it. Replace/restart the pod only with approval and no active capture;
   confirm catalog and replay persist afterward.
5. Disconnect the browser; verify `device_busy=false` and no remaining `rtl_sdr`.
6. Check the browser console, WASM FFT and real WebGPU waterfall.

## Rollback

Revert the image-promotion commit in GitOps and merge/push through the normal
approval process; ArgoCD restores that revision. A digest-only rollback keeps the
same recordings volume. Rolling back the first migration restores the old runtime
hostPath and requires `/opt/sdr-lab/runtime` to remain available. Do not delete it
until the production image and real recording/replay acceptance pass. Rollback
does not delete recordings; a future incompatible recording format would require
separate migration planning.
