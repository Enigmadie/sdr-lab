/// <reference lib="webworker" />
import init, { Spectrum } from '../../../../crates/dsp-wasm/pkg/sdr_dsp_wasm';
import { decodeIqBlock } from '../shared/lib/decode-iq-block';
import {
  inspectContinuity,
  type BlockIdentity,
} from '../shared/lib/stream-continuity';
import { createInitialMetrics } from './initial-metrics';
import type { SpectrumFrame, WorkerCommand, WorkerEvent } from './messages';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const wasmReady = init();

let socket: WebSocket | undefined;
let spectrum: Spectrum | undefined;
let fftSize = 0;
let previousBlock: BlockIdentity | undefined;
let metrics = createInitialMetrics();
let diagnosticsTimer: ReturnType<typeof setInterval> | undefined;
let lastBlockAt: number | undefined;
let intervalStart = 0;
let receivedBytes = 0;
let receivedBlocks = 0;
let pendingPing: number | undefined;
let frameInFlight = false;
let pendingFrame: SpectrumFrame | undefined;
let metricsInFlight = false;
let connectionGeneration = 0;
let positionInFlight = false;
let pendingPosition: number | undefined;

function publishPosition(seconds: number): void {
  if (positionInFlight) {
    pendingPosition = seconds;
    return;
  }
  positionInFlight = true;
  send({ type: 'playback-position', seconds });
}

function send(event: WorkerEvent, transfer: Transferable[] = []): void {
  scope.postMessage(event, transfer);
}

function stop(): void {
  clearInterval(diagnosticsTimer);
  diagnosticsTimer = undefined;
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close();
    socket = undefined;
  }

  spectrum?.free();
  spectrum = undefined;
  fftSize = 0;
  pendingFrame = undefined;
}

function publishFrame(frame: SpectrumFrame): void {
  if (frameInFlight) {
    if (pendingFrame) {
      metrics.coalescedFrames++;
    }
    pendingFrame = frame;
    return;
  }
  frameInFlight = true;
  send(frame, [frame.bins.buffer as ArrayBuffer]);
}

function reportMetrics(): void {
  const now = performance.now();
  const seconds = (now - intervalStart) / 1000;
  metrics.blocksPerSecond = receivedBlocks / seconds;
  metrics.bytesPerSecond = receivedBytes / seconds;
  metrics.lastBlockAgeMs = lastBlockAt === undefined ? null : now - lastBlockAt;
  metrics.displayQueueDepth = Number(frameInFlight) + Number(!!pendingFrame);
  if (!metricsInFlight) {
    metricsInFlight = true;
    send({ type: 'metrics', metrics: { ...metrics } });
  }
  intervalStart = now;
  receivedBlocks = 0;
  receivedBytes = 0;
  if (socket?.readyState === WebSocket.OPEN) {
    if (pendingPing === undefined) {
      pendingPing = now;
      socket.send(`ping:${now}`);
    } else if (now - pendingPing > 2000) {
      metrics.rttMs = null;
      pendingPing = undefined;
    }
  }
}

function reportError(error: unknown): void {
  stop();
  send({ type: 'status', state: 'error', detail: String(error) });
}

function getSpectrum(size: number): Spectrum {
  if (!spectrum || fftSize !== size) {
    spectrum?.free();
    spectrum = new Spectrum(size);
    fftSize = size;
  }

  return spectrum;
}

function processBlock({
  data: buffer,
}: MessageEvent<ArrayBuffer | string>): void {
  try {
    if (typeof buffer === 'string') {
      if (buffer === 'replay-ended') {
        reportMetrics();
        stop();
        send({
          type: 'status',
          state: 'disconnected',
          detail: 'Playback finished.',
        });
        return;
      }
      if (buffer.startsWith('position:')) {
        publishPosition(Number(buffer.slice(9)));
        return;
      }
      if (buffer.startsWith('record-error:')) {
        send({ type: 'record-error', detail: buffer.slice(13) });
        return;
      }
      if (buffer.startsWith('error:')) {
        reportError(buffer.slice(6));
        return;
      }
      if (pendingPing !== undefined && buffer === `ping:${pendingPing}`) {
        metrics.rttMs = performance.now() - pendingPing;
        pendingPing = undefined;
      }
      return;
    }
    const start = performance.now();
    const block = decodeIqBlock(buffer);
    lastBlockAt = start;
    receivedBytes += buffer.byteLength;
    receivedBlocks++;
    const continuity = inspectContinuity(previousBlock, block);
    if (continuity.reset) {
      metrics.discontinuities++;
      spectrum?.free();
      spectrum = undefined;
      fftSize = 0;
    }
    if (continuity.rejected) {
      metrics.rejectedBlocks++;
      socket?.send(`ack:${block.sequence}`);
      return;
    }
    metrics.gaps += continuity.missing;
    previousBlock = {
      sequence: block.sequence,
      sampleRate: block.sampleRate,
      count: block.count,
      centerHz: block.centerHz,
    };
    const bins = getSpectrum(block.samples.length / 2).process(block.samples);
    metrics.processingMs = performance.now() - start;
    metrics.maxProcessingMs = Math.max(
      metrics.maxProcessingMs,
      metrics.processingMs,
    );
    metrics.sequence = block.sequence;
    metrics.sampleRate = block.sampleRate;
    metrics.centerHz = block.centerHz;
    metrics.blockDurationMs = (block.count / block.sampleRate) * 1000;
    socket?.send(`ack:${block.sequence}`);
    publishFrame({
      type: 'spectrum',
      bins,
      sampleRate: block.sampleRate,
      centerHz: block.centerHz,
      sequence: block.sequence,
      gaps: metrics.gaps,
      processingMs: metrics.processingMs,
    });
  } catch (error) {
    reportError(error);
  }
}

async function handleCommand({
  data,
}: MessageEvent<WorkerCommand>): Promise<void> {
  if (data.type === 'playback-position-consumed') {
    positionInFlight = false;
    if (pendingPosition !== undefined) {
      const seconds = pendingPosition;
      pendingPosition = undefined;
      publishPosition(seconds);
    }
    return;
  }
  if (data.type === 'record' || data.type === 'record-stop') {
    if (socket?.readyState !== WebSocket.OPEN) {
      send({
        type: 'record-error',
        detail: 'Connect to a capture source first.',
      });
      return;
    }
    socket.send(
      data.type === 'record-stop'
        ? 'record-stop'
        : `record:${JSON.stringify({ name: data.name, seconds: data.seconds })}`,
    );
    return;
  }
  if (data.type === 'metrics-consumed') {
    metricsInFlight = false;
    return;
  }
  if (data.type === 'frame-consumed') {
    frameInFlight = false;
    if (pendingFrame) {
      const frame = pendingFrame;
      pendingFrame = undefined;
      publishFrame(frame);
    }
    return;
  }
  const currentGeneration = ++connectionGeneration;

  stop();
  previousBlock = undefined;
  metrics = createInitialMetrics();
  lastBlockAt = undefined;
  pendingPing = undefined;
  frameInFlight = false;
  metricsInFlight = false;
  receivedBytes = 0;
  receivedBlocks = 0;

  if (data.type === 'stop') {
    positionInFlight = false;
    pendingPosition = undefined;
    return;
  }
  positionInFlight = false;
  pendingPosition = undefined;

  send({ type: 'status', state: 'connecting' });

  try {
    await wasmReady;

    // A newer command may have cancelled this connection while WASM loaded.
    if (connectionGeneration !== currentGeneration) {
      return;
    }

    socket = new WebSocket(data.url);
    socket.binaryType = 'arraybuffer';
    socket.onmessage = processBlock;
    socket.onopen = () => {
      intervalStart = performance.now();
      diagnosticsTimer = setInterval(reportMetrics, 500);
      send({ type: 'status', state: 'live' });
    };
    socket.onclose = () => {
      reportMetrics();
      stop();
      send({ type: 'status', state: 'disconnected' });
    };
    socket.onerror = () =>
      reportError('Unable to connect to the signal server.');
  } catch (error) {
    if (connectionGeneration === currentGeneration) {
      reportError(error);
    }
  }
}

scope.onmessage = handleCommand;
