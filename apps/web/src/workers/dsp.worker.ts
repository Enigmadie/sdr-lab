/// <reference lib="webworker" />
import init, { Spectrum } from '../../../../crates/dsp-wasm/pkg/sdr_dsp_wasm';
import { decodeIqBlock } from '../shared/lib/decode-iq-block';
import type { WorkerCommand, WorkerEvent } from './messages';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const wasmReady = init();

let socket: WebSocket | undefined;
let spectrum: Spectrum | undefined;
let fftSize = 0;
let previousSequence: number | undefined;
let droppedBlocks = 0;
let connectionGeneration = 0;

function send(event: WorkerEvent, transfer: Transferable[] = []): void {
  scope.postMessage(event, transfer);
}

function stop(): void {
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

function processBlock({ data: buffer }: MessageEvent<ArrayBuffer>): void {
  try {
    const start = performance.now();
    const block = decodeIqBlock(buffer);

    if (previousSequence !== undefined) {
      // Unsigned subtraction also handles sequence wraparound at 2^32.
      const missingBlocks = (block.sequence - previousSequence - 1) >>> 0;
      droppedBlocks += missingBlocks;
    }

    previousSequence = block.sequence;

    const bins = getSpectrum(block.count).process(block.samples);

    send(
      {
        type: 'spectrum',
        bins,
        sampleRate: block.sampleRate,
        sequence: block.sequence,
        gaps: droppedBlocks,
        processingMs: performance.now() - start,
      },
      [bins.buffer as ArrayBuffer],
    );
  } catch (error) {
    reportError(error);
  }
}

async function handleCommand({
  data,
}: MessageEvent<WorkerCommand>): Promise<void> {
  const currentGeneration = ++connectionGeneration;

  stop();
  previousSequence = undefined;
  droppedBlocks = 0;

  if (data.type === 'stop') {
    return;
  }

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
    socket.onopen = () => send({ type: 'status', state: 'live' });
    socket.onclose = () => send({ type: 'status', state: 'disconnected' });
    socket.onerror = () =>
      reportError('Unable to connect to the signal server.');
  } catch (error) {
    if (connectionGeneration === currentGeneration) {
      reportError(error);
    }
  }
}

scope.onmessage = handleCommand;
